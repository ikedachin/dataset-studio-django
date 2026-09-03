from __future__ import annotations

import json
import threading
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from django.db import close_old_connections, transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables

from dataset_guard.policies import project_block_reason, split_block_reason
from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob

from .huggingface import HuggingFaceError, public_error, resolve_token
from .import_targets import dataset_name_for, split_name_for
from .json_tools import search_text
from .schema import SchemaProfiler

BATCH_SIZE = 1000
_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_recovered = False
_process_started_at = timezone.now()
# The local application uses one process and one import worker. Serialize job
# reservations as SQLite select_for_update does not provide row locks.
import_submission_lock = threading.RLock()


class ImportFormatError(Exception):
    def __init__(self, message: str, line: int | None = None, preview: str = "") -> None:
        super().__init__(message)
        self.line = line
        self.preview = preview


def iter_jsonl(path: str | Path) -> Iterator[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ImportFormatError(str(exc), line_number, line[:240].rstrip()) from exc
            if not isinstance(value, dict):
                raise ImportFormatError("Each JSONL line must contain a JSON object", line_number, line[:240].rstrip())
            yield value


def count_nonempty_lines(path: str | Path) -> int:
    with Path(path).open("rb") as source:
        return sum(bool(line.strip()) for line in source)


@sensitive_variables()
def iter_huggingface(config: dict[str, Any], token: str | None = None) -> Iterable[dict[str, Any]]:
    from datasets import load_dataset

    dataset = load_dataset(
        config["repository"],
        config.get("configuration"),
        split=config.get("split", "train"),
        revision=config.get("revision"),
        token=token,
        streaming=True,
    )
    for record in dataset:
        yield dict(record)


@sensitive_variables()
def _source(job: ImportJob, token: str | None = None) -> tuple[Iterable[dict[str, Any]], int | None]:
    config = job.source_config
    if job.source_type in {"upload", "local"}:
        path = Path(config["path"]).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise ImportFormatError("Source file does not exist")
        if path.suffix.lower() not in {".jsonl", ".ndjson"}:
            raise ImportFormatError("Source file must use .jsonl or .ndjson")
        return iter_jsonl(path), count_nonempty_lines(path)
    if job.source_type == "huggingface":
        return iter_huggingface(config, token), None
    raise ImportFormatError("Unsupported import source")


@sensitive_variables()
def run_import_job(job_id: int, hf_token: str | None = None) -> None:
    close_old_connections()
    claimed = ImportJob.objects.filter(pk=job_id, status=ImportJob.Status.PENDING).update(
        status=ImportJob.Status.RUNNING, started_at=timezone.now(),
    )
    if not claimed:
        close_old_connections()
        return
    job = ImportJob.objects.select_related("project").get(pk=job_id)
    split: DatasetSplit | None = None
    inserted_ranges: list[tuple[int, int]] = []

    def save_batch(batch: list[DatasetRecord]) -> None:
        # SQLite serializes writers for the entire bulk insert transaction, so
        # these PK ranges belong only to this job, even if another UI adds rows.
        with transaction.atomic():
            DatasetRecord.objects.bulk_create(batch, batch_size=BATCH_SIZE)
            record_range = (batch[0].pk, batch[-1].pk)
            # Commit the ownership journal with the records so a process crash
            # can clean up only this job's partial data on the next startup.
            job.source_config["_record_ranges"] = [*inserted_ranges, record_range]
            job.save(update_fields=["source_config"])
        inserted_ranges.append(record_range)
        batch.clear()

    try:
        reason = project_block_reason(job.project)
        if reason:
            raise HuggingFaceError(reason[0], reason[1]) if job.source_type == "huggingface" else ImportFormatError(reason[1])
        records, total = _source(job, hf_token)
        job.progress_total = total
        job.save(update_fields=["progress_total"])
        split_name = split_name_for(job.source_config)
        dataset_name = dataset_name_for(job.source_type, job.source_config, job.project.name)
        job.source_config["dataset_name"] = dataset_name
        split, _ = DatasetSplit.objects.get_or_create(
            project=job.project,
            dataset_name=dataset_name,
            name=split_name,
            defaults={"position": job.project.splits.count()},
        )
        reason = split_block_reason(split)
        if reason:
            raise HuggingFaceError(reason[0], reason[1]) if job.source_type == "huggingface" else ImportFormatError(reason[1])
        if split.record_count or split.records.exists():
            if job.source_type == "huggingface":
                raise HuggingFaceError("SPLIT_NOT_EMPTY", "The destination split already contains records. Choose an empty split.")
            raise ImportFormatError(f"Split '{split.name}' already contains records")
        batch: list[DatasetRecord] = []
        current = 0
        for current, value in enumerate(records, start=1):
            if job.source_type == "huggingface":
                # Reject non-JSON values (including NaN) before writing a batch.
                json.dumps(value, allow_nan=False)
            batch.append(
                DatasetRecord(
                    split=split,
                    position=current,
                    original_json=value,
                    current_json=value,
                    search_text=search_text(value),
                )
            )
            if len(batch) >= BATCH_SIZE:
                save_batch(batch)
                ImportJob.objects.filter(pk=job.pk).update(progress_current=current)
        if batch:
            save_batch(batch)
        profiler = SchemaProfiler()
        for value in DatasetRecord.objects.filter(
            split__project=job.project, split__deleted_at__isnull=True, is_deleted=False,
        ).values_list("current_json", flat=True).iterator(chunk_size=BATCH_SIZE):
            profiler.observe(value)
        with transaction.atomic():
            split.record_count = split.records.filter(is_deleted=False).count()
            split.save(update_fields=["record_count"])
            job.project.inferred_schema = profiler.result()
            job.project.save(update_fields=["inferred_schema", "updated_at"])
            job.status = ImportJob.Status.COMPLETED
            job.progress_current = current
            job.source_config.pop("_record_ranges", None)
            job.save(update_fields=["status", "progress_current", "source_config"])
    except Exception as exc:
        if split is not None and inserted_ranges:
            for first, last in inserted_ranges:
                split.records.filter(pk__gte=first, pk__lte=last).delete()
            split.record_count = split.records.filter(is_deleted=False).count()
            split.save(update_fields=["record_count"])
        job.status = ImportJob.Status.FAILED
        job.progress_current = 0
        job.source_config.pop("_record_ranges", None)
        job.error = public_error(exc) if job.source_type == "huggingface" else {
            "message": str(exc),
            "line": getattr(exc, "line", None),
            "preview": getattr(exc, "preview", ""),
        }
    finally:
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "progress_current", "source_config", "error", "finished_at"])
        if job.source_type == "upload":
            Path(job.source_config["path"]).unlink(missing_ok=True)
        close_old_connections()


def recover_import_jobs() -> None:
    global _recovered
    with _executor_lock:
        if not _recovered:
            interrupted = ImportJob.objects.filter(
                status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING],
                created_at__lt=_process_started_at,
            )
            for job in interrupted:
                with transaction.atomic():
                    ranges = job.source_config.pop("_record_ranges", [])
                    target_name = split_name_for(job.source_config)
                    dataset_name = dataset_name_for(job.source_type, job.source_config, job.project.name)
                    target = DatasetSplit.objects.filter(project_id=job.project_id, dataset_name=dataset_name, name=target_name).first()
                    if ranges and target:
                        for first, last in ranges:
                            target.records.filter(pk__gte=first, pk__lte=last).delete()
                        target.record_count = target.records.filter(is_deleted=False).count()
                        target.save(update_fields=["record_count"])
                    job.status = ImportJob.Status.INTERRUPTED
                    job.progress_current = 0
                    job.error = {"message": "The application stopped. Re-enter HF_TOKEN if needed and start the import again."}
                    job.finished_at = timezone.now()
                    job.save(update_fields=["status", "progress_current", "source_config", "error", "finished_at"])
            _recovered = True


@sensitive_variables()
def submit_import(job: ImportJob, synchronous: bool = False, hf_token: str | None = None) -> None:
    global _executor
    recover_import_jobs()
    token = resolve_token(hf_token) if job.source_type == "huggingface" else None
    if synchronous:
        run_import_job(job.pk, token)
        return
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset-import")
    _executor.submit(run_import_job, job.pk, token)
