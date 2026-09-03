from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_http_methods

from dataset_guard.policies import project_block_reason, visible_projects, visible_splits
from datasets_app.models import Project
from datasets_app.schemas.requests import ProjectCreate, ProjectUpdate
from datasets_app.services.validation import validate_project

from .common import api_errors, body_as, error, success
from .serializers import project_data, split_data


@api_errors
@require_http_methods(["GET", "POST"])
def projects(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return success([project_data(p) for p in visible_projects().order_by("-updated_at")])
    payload = body_as(request, ProjectCreate)
    project = Project.objects.create(name=payload.name, source_type=payload.source_type)
    return success(project_data(project), 201)


@api_errors
@require_http_methods(["GET", "PATCH", "DELETE"])
def project_detail(request: HttpRequest, project_id: int) -> JsonResponse:
    project = get_object_or_404(visible_projects(), pk=project_id)
    if request.method == "GET":
        return success(project_data(project))
    if request.method == "DELETE":
        reason = project_block_reason(project)
        if reason:
            return error(reason[0], reason[1], 409)
        project.delete()
        return success(None)
    payload = body_as(request, ProjectUpdate)
    reason = project_block_reason(project)
    if reason:
        return error(reason[0], reason[1], 409)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    project.save()
    return success(project_data(project))


@require_GET
def project_splits(request: HttpRequest, project_id: int) -> JsonResponse:
    project = get_object_or_404(visible_projects(), pk=project_id)
    return success([split_data(s) for s in visible_splits().filter(project=project)])


@require_http_methods(["POST"])
def project_validate(request: HttpRequest, project_id: int) -> JsonResponse:
    project = get_object_or_404(visible_projects(), pk=project_id)
    reason = project_block_reason(project)
    if reason:
        return error(reason[0], reason[1], 409)
    return success(validate_project(project))
