from pathlib import Path

from django.http import HttpRequest, JsonResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_POST

from datasets_app.models import DatasetSplit
from datasets_app.schemas.requests import ExportPath
from datasets_app.services.exporting import export_to_path, iter_export

from .common import api_errors, body_as, error, success


@require_GET
def export_download(request: HttpRequest) -> StreamingHttpResponse:
    split = get_object_or_404(DatasetSplit, pk=request.GET.get("split_id"))
    response = StreamingHttpResponse(iter_export(split), content_type="application/x-ndjson; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{split.name}_edited.jsonl"'
    return response


@api_errors
@require_POST
def export_path(request: HttpRequest) -> JsonResponse:
    payload = body_as(request, ExportPath)
    split = get_object_or_404(DatasetSplit, pk=payload.split_id)
    try:
        result = export_to_path(split, payload.path, payload.overwrite)
    except FileExistsError as exc:
        return error("FILE_EXISTS", str(exc), 409, {"path": str(Path(payload.path).expanduser())})
    return success({"path": str(result)})
