from __future__ import annotations

import tempfile
from pathlib import Path

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST

from datasets_app.models import ImportJob, Project
from datasets_app.schemas.requests import HuggingFaceImport, LocalImport
from datasets_app.services.importing import submit_import

from .common import api_errors, body_as, error, success
from .serializers import job_data


def _new_job(project: Project, source_type: str, config: dict) -> ImportJob:
    job = ImportJob.objects.create(project=project, source_type=source_type, source_config=config)
    submit_import(job)
    return job


@require_POST
def import_upload(request: HttpRequest) -> JsonResponse:
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return error("FILE_REQUIRED", "Choose a JSONL file")
    if Path(uploaded.name).suffix.lower() not in {".jsonl", ".ndjson"}:
        return error("INVALID_EXTENSION", "File must use .jsonl or .ndjson")
    project = get_object_or_404(Project, pk=request.POST.get("project_id"))
    upload_dir = Path(settings.APP_DATA_DIR) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=upload_dir, suffix=Path(uploaded.name).suffix, delete=False) as target:
        for chunk in uploaded.chunks():
            target.write(chunk)
        path = target.name
    job = _new_job(project, "upload", {"path": path, "split_name": request.POST.get("split_name", "train"), "filename": uploaded.name})
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
    project = get_object_or_404(Project, pk=payload.project_id)
    return success(job_data(_new_job(project, "local", {"path": str(path), "split_name": payload.split_name})), 202)


@api_errors
@require_POST
def import_huggingface(request: HttpRequest) -> JsonResponse:
    payload = body_as(request, HuggingFaceImport)
    project = get_object_or_404(Project, pk=payload.project_id)
    return success(job_data(_new_job(project, "huggingface", payload.model_dump(exclude={"project_id"}))), 202)


@require_GET
def job_detail(request: HttpRequest, job_id: int) -> JsonResponse:
    return success(job_data(get_object_or_404(ImportJob, pk=job_id)))


@require_GET
def huggingface_info(request: HttpRequest) -> JsonResponse:
    repository = request.GET.get("repository", "").strip()
    if not repository:
        return error("REPOSITORY_REQUIRED", "repository is required")
    try:
        from huggingface_hub import HfApi

        info = HfApi().dataset_info(repository, revision=request.GET.get("revision") or None)
        files = [s.rfilename for s in info.siblings]
        return success({"repository": repository, "files": files, "tags": info.tags or []})
    except Exception as exc:
        return error("HUGGINGFACE_ERROR", str(exc), 422)
