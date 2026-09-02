from __future__ import annotations

import copy
from typing import Any

from django.db import transaction
from django.db.models import F, Max, Q, QuerySet
from django.utils import timezone

from datasets_app.models import DatasetRecord, DatasetSplit

from .json_tools import search_text


class VersionConflict(Exception):
    pass


def next_position(split: DatasetSplit) -> int:
    return (split.records.aggregate(value=Max("position"))["value"] or 0) + 1


def create_record(split: DatasetSplit, data: dict[str, Any] | None = None) -> DatasetRecord:
    payload = data or {}
    with transaction.atomic():
        record = DatasetRecord.objects.create(
            split=split,
            position=next_position(split),
            original_json={},
            current_json=payload,
            search_text=search_text(payload),
            status=DatasetRecord.Status.NEW,
            is_new=True,
        )
        DatasetSplit.objects.filter(pk=split.pk).update(record_count=F("record_count") + 1)
    return record


def update_record(record_id: int, version: int, data: dict[str, Any]) -> DatasetRecord:
    with transaction.atomic():
        record = DatasetRecord.objects.select_for_update().get(pk=record_id)
        if record.version != version:
            raise VersionConflict
        status = DatasetRecord.Status.NEW if record.is_new else (
            DatasetRecord.Status.UNEDITED if data == record.original_json else DatasetRecord.Status.EDITED
        )
        changed = DatasetRecord.objects.filter(pk=record_id, version=version).update(
            current_json=data,
            search_text=search_text(data),
            status=status,
            version=version + 1,
            updated_at=timezone.now(),
        )
        if not changed:
            raise VersionConflict
    return DatasetRecord.objects.get(pk=record_id)


def set_deleted(record: DatasetRecord, deleted: bool) -> DatasetRecord:
    record.is_deleted = deleted
    record.version += 1
    record.save(update_fields=["is_deleted", "version", "updated_at"])
    return record


def duplicate_record(record: DatasetRecord) -> DatasetRecord:
    return create_record(record.split, copy.deepcopy(record.current_json))


def revert_record(record: DatasetRecord) -> DatasetRecord | None:
    if record.is_new:
        split_id = record.split_id
        record.delete()
        DatasetSplit.objects.filter(pk=split_id, record_count__gt=0).update(
            record_count=F("record_count") - 1
        )
        return None
    record.current_json = copy.deepcopy(record.original_json)
    record.search_text = search_text(record.current_json)
    record.is_deleted = False
    record.status = DatasetRecord.Status.UNEDITED
    record.version += 1
    record.save()
    return record


def apply_record_filters(queryset: QuerySet[DatasetRecord], filters: list[dict[str, Any]]):
    from .json_tools import parse_path

    for item in filters:
        path = "current_json__" + "__".join(str(part) for part in parse_path(item["path"]))
        expected = item.get("value")
        operator = item["operator"]
        if operator == "exists":
            queryset = queryset.filter(**{f"{path}__isnull": False})
        elif operator == "missing":
            queryset = queryset.filter(**{f"{path}__isnull": True})
        elif operator == "empty":
            queryset = queryset.filter(
                Q(**{path: None}) | Q(**{path: ""}) | Q(**{path: []}) | Q(**{path: {}})
            )
        elif operator == "not_empty":
            queryset = queryset.filter(**{f"{path}__isnull": False}).exclude(
                Q(**{path: None}) | Q(**{path: ""}) | Q(**{path: []}) | Q(**{path: {}})
            )
        elif operator == "equals":
            queryset = queryset.filter(**{path: expected})
        elif operator == "not_equals":
            queryset = queryset.exclude(**{path: expected})
        elif operator == "contains":
            queryset = queryset.filter(**{f"{path}__icontains": expected})
        elif operator == "not_contains":
            queryset = queryset.exclude(**{f"{path}__icontains": expected})
        elif operator in {"gt", "gte", "lt", "lte"}:
            queryset = queryset.filter(**{f"{path}__{operator}": expected})
        else:
            raise ValueError(f"Unsupported filter operator: {operator}")
    return queryset
