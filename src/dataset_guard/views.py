from __future__ import annotations

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from datasets_app.models import DatasetSplit, Project
from datasets_app.views.common import api_errors, body_as, error, success

from .models import GuardAuditLog
from .policies import (
    project_block_reason,
    project_identifier,
    split_block_reason,
    split_effectively_protected,
)
from .schemas import GuardActionRequest


def _serialize_split(split: DatasetSplit) -> dict:
    return {
        "id": split.pk,
        "name": split.name,
        "projectId": split.project_id,
        "projectName": split.project.name,
        "isProtected": split.is_protected,
        "isInheritedProtected": split.project.is_protected,
        "isEffectivelyProtected": split_effectively_protected(split),
        "deletedAt": split.deleted_at.isoformat() if split.deleted_at else None,
    }


def _serialize_project(project: Project, include_deleted_splits: bool = False) -> dict:
    split_query = project.splits.select_related("project")
    if not include_deleted_splits:
        split_query = split_query.filter(deleted_at__isnull=True)
    return {
        "id": project.pk,
        "name": project.name,
        "guardId": project_identifier(project),
        "isProtected": project.is_protected,
        "deletedAt": project.deleted_at.isoformat() if project.deleted_at else None,
        "splits": [_serialize_split(split) for split in split_query],
    }


def _serialize_log(log: GuardAuditLog) -> dict:
    return {
        "id": log.pk,
        "targetType": log.target_type,
        "targetId": log.target_id,
        "action": log.action,
        "confirmationText": log.confirmation_text,
        "result": log.result,
        "message": log.message,
        "actor": log.actor,
        "executedAt": log.executed_at.isoformat(),
    }


def _create_audit(
    *,
    target_type: GuardAuditLog.TargetType,
    target_id: str,
    action: GuardAuditLog.ActionType,
    confirmation_text: str,
    result: GuardAuditLog.ResultType,
    message: str = "",
) -> None:
    GuardAuditLog.objects.create(
        target_type=target_type,
        target_id=target_id,
        action=action,
        confirmation_text=confirmation_text,
        result=result,
        message=message,
    )


@require_GET
def resources(request: HttpRequest) -> JsonResponse:
    projects = Project.objects.prefetch_related("splits").order_by("name", "id")
    active = projects.filter(deleted_at__isnull=True)
    deleted = projects.filter(deleted_at__isnull=False)
    deleted_splits = DatasetSplit.objects.select_related("project").filter(
        deleted_at__isnull=False,
        project__deleted_at__isnull=True,
    )
    return success(
        {
            "projects": [_serialize_project(project) for project in active],
            "deletedProjects": [
                _serialize_project(project, include_deleted_splits=True) for project in deleted
            ],
            "deletedSplits": [_serialize_split(split) for split in deleted_splits],
        }
    )


@require_GET
def audit_logs(request: HttpRequest) -> JsonResponse:
    rows = GuardAuditLog.objects.all()[:100]
    return success([_serialize_log(row) for row in rows])


@api_errors
@require_POST
def project_action(request: HttpRequest, project_id: int) -> JsonResponse:
    project = get_object_or_404(Project, pk=project_id)
    payload = body_as(request, GuardActionRequest)
    expected = project_identifier(project)
    if payload.confirmation_text != expected:
        message = f"Confirmation text must exactly match '{expected}'"
        _create_audit(
            target_type=GuardAuditLog.TargetType.PROJECT,
            target_id=expected,
            action=payload.action,
            confirmation_text=payload.confirmation_text,
            result=GuardAuditLog.ResultType.REJECTED,
            message=message,
        )
        return error("CONFIRMATION_MISMATCH", message, 422)

    if payload.action == "protect":
        if project.deleted_at:
            message = "Cannot protect a logically deleted project"
            _create_audit(
                target_type=GuardAuditLog.TargetType.PROJECT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=message,
            )
            return error("INVALID_STATE", message, 409)
        project.is_protected = True
        project.save(update_fields=["is_protected", "updated_at"])
    elif payload.action == "unprotect":
        project.is_protected = False
        project.save(update_fields=["is_protected", "updated_at"])
    elif payload.action == "soft_delete":
        reason = project_block_reason(project)
        if reason:
            _create_audit(
                target_type=GuardAuditLog.TargetType.PROJECT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=reason[1],
            )
            return error(reason[0], reason[1], 409)
        now = timezone.now()
        with transaction.atomic():
            project.deleted_at = now
            project.save(update_fields=["deleted_at", "updated_at"])
            project.splits.filter(deleted_at__isnull=True).update(deleted_at=now)
    else:
        reason = project_block_reason(project)
        if reason:
            _create_audit(
                target_type=GuardAuditLog.TargetType.PROJECT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=reason[1],
            )
            return error(reason[0], reason[1], 409)
        project.delete()
        _create_audit(
            target_type=GuardAuditLog.TargetType.PROJECT,
            target_id=expected,
            action=payload.action,
            confirmation_text=payload.confirmation_text,
            result=GuardAuditLog.ResultType.SUCCESS,
        )
        return success({"deleted": True})

    _create_audit(
        target_type=GuardAuditLog.TargetType.PROJECT,
        target_id=expected,
        action=payload.action,
        confirmation_text=payload.confirmation_text,
        result=GuardAuditLog.ResultType.SUCCESS,
    )
    return success(_serialize_project(Project.objects.prefetch_related("splits").get(pk=project_id)))


@api_errors
@require_POST
def split_action(request: HttpRequest, split_id: int) -> JsonResponse:
    split = get_object_or_404(DatasetSplit.objects.select_related("project"), pk=split_id)
    payload = body_as(request, GuardActionRequest)
    expected = split.name
    if payload.confirmation_text != expected:
        message = f"Confirmation text must exactly match '{expected}'"
        _create_audit(
            target_type=GuardAuditLog.TargetType.SPLIT,
            target_id=expected,
            action=payload.action,
            confirmation_text=payload.confirmation_text,
            result=GuardAuditLog.ResultType.REJECTED,
            message=message,
        )
        return error("CONFIRMATION_MISMATCH", message, 422)

    if payload.action == "protect":
        if split.deleted_at or split.project.deleted_at:
            message = "Cannot protect a logically deleted split"
            _create_audit(
                target_type=GuardAuditLog.TargetType.SPLIT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=message,
            )
            return error("INVALID_STATE", message, 409)
        split.is_protected = True
        split.save(update_fields=["is_protected"])
    elif payload.action == "unprotect":
        split.is_protected = False
        split.save(update_fields=["is_protected"])
    elif payload.action == "soft_delete":
        reason = split_block_reason(split)
        if reason:
            _create_audit(
                target_type=GuardAuditLog.TargetType.SPLIT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=reason[1],
            )
            return error(reason[0], reason[1], 409)
        split.deleted_at = timezone.now()
        split.save(update_fields=["deleted_at"])
    else:
        reason = split_block_reason(split)
        if reason:
            _create_audit(
                target_type=GuardAuditLog.TargetType.SPLIT,
                target_id=expected,
                action=payload.action,
                confirmation_text=payload.confirmation_text,
                result=GuardAuditLog.ResultType.REJECTED,
                message=reason[1],
            )
            return error(reason[0], reason[1], 409)
        split.delete()
        _create_audit(
            target_type=GuardAuditLog.TargetType.SPLIT,
            target_id=expected,
            action=payload.action,
            confirmation_text=payload.confirmation_text,
            result=GuardAuditLog.ResultType.SUCCESS,
        )
        return success({"deleted": True})

    _create_audit(
        target_type=GuardAuditLog.TargetType.SPLIT,
        target_id=expected,
        action=payload.action,
        confirmation_text=payload.confirmation_text,
        result=GuardAuditLog.ResultType.SUCCESS,
    )
    return success(_serialize_split(DatasetSplit.objects.select_related("project").get(pk=split_id)))
