from __future__ import annotations

from django.db.models import QuerySet

from datasets_app.models import DatasetRecord, DatasetSplit, Project


def visible_projects() -> QuerySet[Project]:
    return Project.objects.filter(deleted_at__isnull=True)


def visible_splits() -> QuerySet[DatasetSplit]:
    return DatasetSplit.objects.filter(deleted_at__isnull=True, project__deleted_at__isnull=True)


def visible_records() -> QuerySet[DatasetRecord]:
    return DatasetRecord.objects.filter(
        split__deleted_at__isnull=True,
        split__project__deleted_at__isnull=True,
    )


def project_identifier(project: Project) -> str:
    repository = str(project.source_metadata.get("repository", "")).strip()
    if "/" in repository:
        return repository
    if "/" in project.name:
        return project.name
    return f"default/{project.name}"


def split_effectively_protected(split: DatasetSplit) -> bool:
    return split.is_protected or split.project.is_protected


def project_block_reason(project: Project) -> tuple[str, str] | None:
    if project.deleted_at:
        return "PROJECT_LOGICALLY_DELETED", "Project is logically deleted"
    if project.is_protected:
        return "PROJECT_PROTECTED", "Project is protected"
    return None


def split_block_reason(split: DatasetSplit) -> tuple[str, str] | None:
    if split.deleted_at or split.project.deleted_at:
        return "SPLIT_LOGICALLY_DELETED", "Split is logically deleted"
    if split_effectively_protected(split):
        return "SPLIT_PROTECTED", "Split is protected"
    return None

