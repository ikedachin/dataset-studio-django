from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from django.db import close_old_connections, transaction
from django.utils import timezone

from dataset_guard.policies import project_block_reason, split_block_reason
from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob

from .json_tools import search_text
from .schema import SchemaProfiler

BATCH_SIZE = 1000
_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_recovered = False


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


def iter_huggingface(config: dict[str, Any]) -> Iterable[dict[str, Any]]:
    from datasets import load_dataset

    dataset = load_dataset(
        config["repository"],
        config.get("configuration"),
        split=config.get("split", "train"),
        revision=config.get("revision"),
        token=os.environ.get("HF_TOKEN"),
        streaming=True,
    )
    for record in dataset:
        yield dict(record)


def _source(job: ImportJob) -> tuple[Iterable[dict[str, Any]], int | None]:
    config = job.source_config
    if job.source_type in {"upload", "local"}:
        path = Path(config["path"]).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise ImportFormatError("Source file does not exist")
        if path.suffix.lower() not in {".jsonl", ".ndjson"}:
            raise ImportFormatError("Source file must use .jsonl or .ndjson")
        return iter_jsonl(path), count_nonempty_lines(path)
    if job.source_type == "huggingface":
        return iter_huggingface(config), None
    raise ImportFormatError("Unsupported import source")


def run_import_job(job_id: int) -> None:
    close_old_connections()
    job = ImportJob.objects.select_related("project").get(pk=job_id)
    job.status = ImportJob.Status.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=["status", "started_at"])
    profiler = SchemaProfiler()
    split: DatasetSplit | None = None
    can_cleanup = False
    try:
        reason = project_block_reason(job.project)
        if reason:
            raise ImportFormatError(reason[1])
        records, total = _source(job)
        job.progress_total = total
        job.save(update_fields=["progress_total"])
        split_name = job.source_config.get("split_name") or job.source_config.get("split") or "train"
        split, _ = DatasetSplit.objects.get_or_create(
            project=job.project,
            name=split_name,
            defaults={"position": job.project.splits.count()},
        )
        reason = split_block_reason(split)
        if reason:
            raise ImportFormatError(reason[1])
        if split.record_count:
            raise ImportFormatError(f"Split '{split.name}' already contains records")
        can_cleanup = True
        batch: list[DatasetRecord] = []
        current = 0
        for current, value in enumerate(records, start=1):
            profiler.observe(value)
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
                with transaction.atomic():
                    DatasetRecord.objects.bulk_create(batch, batch_size=BATCH_SIZE)
                batch.clear()
                ImportJob.objects.filter(pk=job.pk).update(progress_current=current)
        if batch:
            with transaction.atomic():
                DatasetRecord.objects.bulk_create(batch, batch_size=BATCH_SIZE)
        split.record_count = current
        split.save(update_fields=["record_count"])
        job.project.inferred_schema = profiler.result()
        job.project.save(update_fields=["inferred_schema", "updated_at"])
        job.status = ImportJob.Status.COMPLETED
        job.progress_current = current
    except Exception as exc:
        if split is not None and can_cleanup:
            split.records.all().delete()
            split.record_count = 0
            split.save(update_fields=["record_count"])
        job.status = ImportJob.Status.FAILED
        job.error = {
            "message": str(exc),
            "line": getattr(exc, "line", None),
            "preview": getattr(exc, "preview", ""),
        }
    finally:
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "progress_current", "error", "finished_at"])
        if job.source_type == "upload":
            Path(job.source_config["path"]).unlink(missing_ok=True)
        close_old_connections()


def submit_import(job: ImportJob, synchronous: bool = False) -> None:
    global _executor, _recovered
    if synchronous:
        run_import_job(job.pk)
        return
    with _executor_lock:
        if not _recovered:
            ImportJob.objects.filter(status=ImportJob.Status.RUNNING).update(
                status=ImportJob.Status.INTERRUPTED,
                error={"message": "The application stopped while this job was running"},
                finished_at=timezone.now(),
            )
            _recovered = True
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset-import")
    _executor.submit(run_import_job, job.pk)
