from __future__ import annotations

from collections import Counter
from typing import Any

from django.db import transaction

from datasets_app.models import DatasetRecord, Project, RecordValidation

from .json_tools import get_path, json_type


def validation_issues(record: DatasetRecord) -> list[dict[str, str]]:
    project = record.split.project
    data = record.current_json
    issues: list[dict[str, str]] = []
    if not isinstance(data, dict):
        return [{"severity": "error", "code": "NOT_OBJECT", "path": "$", "message": "Record must be an object"}]
    for path in project.validation_settings.get("required_fields", []):
        marker = object()
        if get_path(data, path, marker) is marker:
            issues.append({"severity": "error", "code": "REQUIRED_MISSING", "path": path, "message": f"Required field '{path}' is missing"})
    messages = data.get("messages")
    if messages is not None:
        if not isinstance(messages, list):
            issues.append({"severity": "error", "code": "MESSAGES_TYPE", "path": "messages", "message": "messages must be an array"})
        else:
            for index, message in enumerate(messages):
                if not isinstance(message, dict) or not isinstance(message.get("role"), str) or not isinstance(message.get("content"), str):
                    issues.append({"severity": "error", "code": "INVALID_MESSAGE", "path": f"messages[{index}]", "message": "Each message needs string role and content"})
    fields = project.inferred_schema.get("fields", {})
    for path, stats in fields.items():
        if "[]" in path:
            continue
        marker = object()
        value = get_path(data, path, marker)
        if value is marker or value is None:
            continue
        expected = max(
            ("string", "integer", "float", "boolean", "object", "array"),
            key=lambda kind: stats.get(f"{kind}_count", 0),
        )
        if stats.get(f"{expected}_count", 0) and json_type(value) != expected:
            issues.append({"severity": "warning", "code": "TYPE_INCONSISTENT", "path": path, "message": f"Expected the common type {expected}, got {json_type(value)}"})
    return issues


def validate_record(record: DatasetRecord) -> list[dict[str, str]]:
    issues = validation_issues(record)
    with transaction.atomic():
        record.validations.all().delete()
        RecordValidation.objects.bulk_create(
            [RecordValidation(record=record, severity=i["severity"], code=i["code"], json_path=i["path"], message=i["message"]) for i in issues]
        )
        record.validation_error_count = sum(i["severity"] == "error" for i in issues)
        record.validation_warning_count = sum(i["severity"] == "warning" for i in issues)
        record.save(update_fields=["validation_error_count", "validation_warning_count"])
    return issues


def validate_project(project: Project) -> dict[str, int]:
    identifiers = project.identifier_fields
    duplicate_values: dict[str, set[Any]] = {}
    for path in identifiers:
        values = (
            get_path(record.current_json, path)
            for record in DatasetRecord.objects.filter(
                split__project=project, is_deleted=False
            ).iterator(chunk_size=1000)
        )
        counts = Counter(value for value in values if isinstance(value, (str, int, float, bool)))
        duplicate_values[path] = {value for value, count in counts.items() if count > 1}
    total = valid = warnings = errors = 0
    for record in DatasetRecord.objects.filter(split__project=project, is_deleted=False).select_related("split__project").iterator(chunk_size=500):
        issues = validation_issues(record)
        for path, values in duplicate_values.items():
            value = get_path(record.current_json, path)
            if value in values:
                issues.append({"severity": "error", "code": "DUPLICATE_IDENTIFIER", "path": path, "message": f"Duplicate identifier: {value}"})
        with transaction.atomic():
            record.validations.all().delete()
            RecordValidation.objects.bulk_create([RecordValidation(record=record, severity=i["severity"], code=i["code"], json_path=i["path"], message=i["message"]) for i in issues])
            record.validation_error_count = sum(i["severity"] == "error" for i in issues)
            record.validation_warning_count = sum(i["severity"] == "warning" for i in issues)
            record.save(update_fields=["validation_error_count", "validation_warning_count"])
        total += 1
        errors += record.validation_error_count
        warnings += record.validation_warning_count
        valid += int(not issues)
    return {"total": total, "valid": valid, "warnings": warnings, "errors": errors}
