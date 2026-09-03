from __future__ import annotations

import json

from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from dataset_guard.policies import split_block_reason, visible_records, visible_splits
from datasets_app.models import DatasetRecord
from datasets_app.schemas.requests import RecordCreate, RecordUpdate, SyncRequest
from datasets_app.services.diffing import structural_diff
from datasets_app.services.records import (
    VersionConflict,
    apply_record_filters,
    create_record,
    duplicate_record,
    revert_record,
    set_deleted,
    update_record,
)
from datasets_app.services.syncing import preview_sync
from datasets_app.services.validation import validate_record

from .common import api_errors, body_as, error, success
from .serializers import record_detail, record_summary


@api_errors
@require_http_methods(["GET", "POST"])
def split_records(request: HttpRequest, split_id: int) -> JsonResponse:
    split = get_object_or_404(visible_splits(), pk=split_id)
    if request.method == "POST":
        reason = split_block_reason(split)
        if reason:
            return error(reason[0], reason[1], 409)
        payload = body_as(request, RecordCreate)
        return success(record_detail(create_record(split, payload.data)), 201)
    try:
        limit = min(max(int(request.GET.get("limit", 100)), 1), 500)
        offset = max(int(request.GET.get("offset", 0)), 0)
    except ValueError:
        return error("INVALID_PAGINATION", "limit and offset must be integers")
    queryset = split.records.all()
    status = request.GET.get("status", "all")
    if status == "deleted":
        queryset = queryset.filter(is_deleted=True)
    else:
        queryset = queryset.filter(is_deleted=False)
        if status == "validation_error":
            queryset = queryset.filter(validation_error_count__gt=0)
        elif status != "all":
            queryset = queryset.filter(status=status)
    search = request.GET.get("search", "").strip()
    if search:
        queryset = queryset.filter(search_text__icontains=search)
    raw_filters = request.GET.get("filters")
    if raw_filters:
        parsed = json.loads(raw_filters)
        if not isinstance(parsed, list) or len(parsed) > 10:
            raise ValueError("filters must be an array of at most 10 conditions")
        queryset = apply_record_filters(queryset, parsed)
    sort_path = request.GET.get("sort", "").strip()
    if sort_path:
        from datasets_app.services.json_tools import parse_path

        sort_key = "current_json__" + "__".join(str(part) for part in parse_path(sort_path))
        if request.GET.get("direction") == "desc":
            sort_key = f"-{sort_key}"
        queryset = queryset.order_by(sort_key, "position", "id")
    else:
        queryset = queryset.order_by("position", "id")
    total = queryset.count()
    page = list(queryset[offset : offset + limit])
    return success({"items": [record_summary(r) for r in page], "total": total, "limit": limit, "offset": offset})


@api_errors
@require_http_methods(["GET", "PATCH", "DELETE"])
def record(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    if request.method == "GET":
        return success(record_detail(value))
    if request.method == "DELETE":
        reason = split_block_reason(value.split)
        if reason:
            return error(reason[0], reason[1], 409)
        return success(record_detail(set_deleted(value, True)))
    payload = body_as(request, RecordUpdate)
    reason = split_block_reason(value.split)
    if reason:
        return error(reason[0], reason[1], 409)
    try:
        return success(record_detail(update_record(value.pk, payload.version, payload.data)))
    except VersionConflict:
        current = DatasetRecord.objects.get(pk=value.pk)
        return error("VERSION_CONFLICT", "Record was changed by another save", 409, {"current": record_detail(current)})


@require_POST
def duplicate(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    reason = split_block_reason(value.split)
    if reason:
        return error(reason[0], reason[1], 409)
    return success(record_detail(duplicate_record(value)), 201)


@require_POST
def restore(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    reason = split_block_reason(value.split)
    if reason:
        return error(reason[0], reason[1], 409)
    return success(record_detail(set_deleted(value, False)))


@require_POST
def revert(request: HttpRequest, record_id: int) -> JsonResponse:
    current = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    reason = split_block_reason(current.split)
    if reason:
        return error(reason[0], reason[1], 409)
    value = revert_record(current)
    return success(record_detail(value) if value else {"removed": True})


@require_GET
def diff(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(visible_records(), pk=record_id)
    return success(structural_diff(value.original_json, value.current_json))


@require_POST
def validate(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    reason = split_block_reason(value.split)
    if reason:
        return error(reason[0], reason[1], 409)
    return success(validate_record(value))


@api_errors
@require_POST
def sync(request: HttpRequest, record_id: int) -> JsonResponse:
    value = get_object_or_404(
        visible_records().select_related("split__project"),
        pk=record_id,
    )
    reason = split_block_reason(value.split)
    if reason:
        return error(reason[0], reason[1], 409)
    payload = body_as(request, SyncRequest)
    preview = preview_sync(value.current_json, value.split.project.sync_rules)
    if not payload.apply:
        return success(preview)
    try:
        updated = update_record(value.pk, payload.version, preview["data"])
    except VersionConflict:
        return error("VERSION_CONFLICT", "Record was changed by another save", 409)
    return success({**preview, "record": record_detail(updated)})
