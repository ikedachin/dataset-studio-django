from __future__ import annotations

import tempfile
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.debug import sensitive_variables
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from dataset_guard.policies import project_block_reason, visible_projects
from datasets_app.models import ImportJob, Project
from datasets_app.schemas.requests import (
    HuggingFaceBatchImport,
    HuggingFaceImport,
    HuggingFaceInfo,
    LocalImport,
    UploadImport,
)
from datasets_app.services.huggingface import (
    HuggingFaceError,
    dataset_info,
    public_error,
    resolve_token,
)
from datasets_app.services.import_targets import (
    ImportTargetError,
    check_import_targets,
    dataset_name_for,
)
from datasets_app.services.importing import (
    import_submission_lock,
    recover_import_jobs,
    submit_import,
)

from .common import api_errors, body_as, error, success
from .serializers import job_data


def _new_job(project: Project, source_type: str, config: dict) -> ImportJob:
    config["dataset_name"] = dataset_name_for(source_type, config, project.name)
    with import_submission_lock:
        recover_import_jobs()
        with transaction.atomic():
            Project.objects.filter(pk=project.pk).update(updated_at=F("updated_at"))
            project.refresh_from_db()
            check_import_targets(project, config["dataset_name"], [config["split_name"]])
            job = ImportJob.objects.create(project=project, source_type=source_type, source_config=config)
            transaction.on_commit(lambda: submit_import(job))
    return job


@api_errors
@require_POST
def import_upload(request: HttpRequest) -> JsonResponse:
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return error("FILE_REQUIRED", "Choose a JSONL file")
    if Path(uploaded.name).suffix.lower() not in {".jsonl", ".ndjson"}:
        return error("INVALID_EXTENSION", "File must use .jsonl or .ndjson")
    payload = UploadImport.model_validate(request.POST.dict())
    project = get_object_or_404(visible_projects(), pk=payload.project_id)
    reason = project_block_reason(project)
    if reason:
        return error(reason[0], reason[1], 409)
    upload_dir = Path(settings.APP_DATA_DIR) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=upload_dir, suffix=Path(uploaded.name).suffix, delete=False) as target:
        for chunk in uploaded.chunks():
            target.write(chunk)
        path = target.name
    try:
        job = _new_job(project, "upload", {"path": path, "split_name": payload.split_name, "filename": uploaded.name, "dataset_name": payload.dataset_name})
    except ImportTargetError as exc:
        Path(path).unlink(missing_ok=True)
        return error(exc.code, str(exc), 409)
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise
    return success(job_data(job), 202)


@api_errors
@require_POST
def import_local(request: HttpRequest) -> JsonResponse:
    payload = body_as(request, LocalImport)
    path = Path(payload.path).expanduser().resolve()
    if not path.exists() or not path.is_file():
        return error("FILE_NOT_FOUND", "The local file does not exist", 404)
    if path.suffix.lower() not in {".jsonl", ".ndjson"}:
        return error("INVALID_EXTENSION", "File must use .jsonl or .ndjson")
    project = get_object_or_404(visible_projects(), pk=payload.project_id)
    reason = project_block_reason(project)
    if reason:
        return error(reason[0], reason[1], 409)
    try:
        job = _new_job(project, "local", {"path": str(path), "split_name": payload.split_name, "dataset_name": payload.dataset_name})
    except ImportTargetError as exc:
        return error(exc.code, str(exc), 409)
    return success(job_data(job), 202)


@api_errors
@require_POST
def import_huggingface(request: HttpRequest) -> JsonResponse:
    payload = body_as(request, HuggingFaceImport)
    return _import_huggingface(payload, batch=False)


@api_errors
@require_POST
def import_huggingface_batch(request: HttpRequest) -> JsonResponse:
    return _import_huggingface(body_as(request, HuggingFaceBatchImport), batch=True)


@sensitive_variables()
def _import_huggingface(payload: HuggingFaceImport | HuggingFaceBatchImport, *, batch: bool) -> JsonResponse:
    project = get_object_or_404(visible_projects(), pk=payload.project_id)
    reason = project_block_reason(project)
    if reason:
        return error(reason[0], reason[1], 409)
    splits = payload.splits if isinstance(payload, HuggingFaceBatchImport) else [payload.split]
    if len(splits) != len(set(splits)):
        return error("HF_SPLIT_INVALID", "Choose each split only once.", 422)
    token = resolve_token(payload.hf_token)
    try:
        info = dataset_info(payload.repository, payload.revision, payload.configuration, token)
        if not info["configuration"]:
            raise HuggingFaceError("HF_CONFIGURATION_REQUIRED", "Choose a Configuration before importing.")
        if any(name not in info["splits"] for name in splits):
            raise HuggingFaceError("HF_SPLIT_INVALID", "Choose available splits from the dataset information.")
    except Exception as exc:
        failure = public_error(exc)
        return error(failure["code"], failure["message"], 422)

    targets = splits if batch else [payload.split_name or splits[0]]
    dataset_name = dataset_name_for("huggingface", {
        "dataset_name": payload.dataset_name, "repository": payload.repository, "configuration": info["configuration"],
    })
    with import_submission_lock:
        recover_import_jobs()
        with transaction.atomic():
            # Acquire SQLite's writer reservation before any reads. Otherwise a
            # worker committing a batch between the checks and create() can make
            # the deferred transaction fail with SQLITE_BUSY_SNAPSHOT.
            Project.objects.filter(pk=project.pk).update(updated_at=F("updated_at"))
            project = get_object_or_404(Project.objects.select_for_update(), pk=project.pk)
            try:
                check_import_targets(project, dataset_name, targets)
            except ImportTargetError as exc:
                return error(exc.code, str(exc), 409)
            jobs = []
            for name, target in zip(splits, targets, strict=True):
                # Allowlist persisted settings; credentials never enter source_config.
                config = {
                    "dataset_name": dataset_name,
                    "repository": payload.repository,
                    "revision": payload.revision or None,
                    "configuration": info["configuration"],
                    "split": name,
                    "split_name": target,
                }
                job = ImportJob.objects.create(project=project, source_type="huggingface", source_config=config)
                jobs.append(job)
                transaction.on_commit(lambda job=job: submit_import(job, hf_token=token))
    if batch:
        return success({"jobs": [{"split": name, **job_data(job)} for name, job in zip(splits, jobs, strict=True)]}, 202)
    return success(job_data(jobs[0]), 202)


@require_GET
def job_detail(request: HttpRequest, job_id: int) -> JsonResponse:
    recover_import_jobs()
    return success(job_data(get_object_or_404(ImportJob, pk=job_id)))


@api_errors
@sensitive_variables()
@require_http_methods(["GET", "POST"])
def huggingface_info(request: HttpRequest) -> JsonResponse:
    if request.method == "POST":
        payload = body_as(request, HuggingFaceInfo)
        try:
            token = resolve_token(payload.hf_token)
            return success(dataset_info(payload.repository, payload.revision, payload.configuration, token))
        except Exception as exc:
            failure = public_error(exc)
            return error(failure["code"], failure["message"], 422)
    repository = request.GET.get("repository", "").strip()
    if not repository:
        return error("REPOSITORY_REQUIRED", "repository is required")
    try:
        from huggingface_hub import HfApi

        info = HfApi().dataset_info(repository, revision=request.GET.get("revision") or None)
        files = [s.rfilename for s in info.siblings]
        return success({"repository": repository, "files": files, "tags": info.tags or []})
    except Exception as exc:
        failure = public_error(exc)
        return error(failure["code"], failure["message"], 422)
