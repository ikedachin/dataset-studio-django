"""Shared destination identity and conflict checks for all import sources."""

from pathlib import Path

from dataset_guard.policies import project_block_reason, split_block_reason
from datasets_app.models import DatasetSplit, ImportJob, Project


class ImportTargetError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def dataset_name_for(source_type: str, config: dict, fallback: str = "default") -> str:
    name = config.get("dataset_name")
    if not name:
        if source_type == "huggingface":
            name = config.get("repository")
            configuration = config.get("configuration")
            if name and configuration and configuration != "default":
                name = f"{name}/{configuration}"
        else:
            path = config.get("filename") or config.get("path")
            name = Path(path).stem if path else None
    name = (name or fallback).strip()
    if not name or len(name) > 255:
        raise ValueError("Dataset name must contain between 1 and 255 characters")
    return name


def split_name_for(config: dict) -> str:
    return config.get("split_name") or config.get("split") or "train"


def check_import_targets(project: Project, dataset_name: str, names: list[str]) -> None:
    """Call inside the job reservation transaction before creating any jobs."""
    reason = project_block_reason(project)
    if reason:
        raise ImportTargetError(*reason)
    for target in DatasetSplit.objects.filter(project=project, dataset_name=dataset_name, name__in=names):
        reason = split_block_reason(target)
        if reason:
            raise ImportTargetError(*reason)
        if target.record_count or target.records.exists():
            raise ImportTargetError("SPLIT_NOT_EMPTY", f"Dataset '{dataset_name}' already contains split '{target.name}'. Choose another dataset name.")
    for job in project.import_jobs.filter(status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING]):
        if dataset_name_for(job.source_type, job.source_config, project.name) == dataset_name and split_name_for(job.source_config) in names:
            raise ImportTargetError("SPLIT_IMPORT_ACTIVE", f"Dataset '{dataset_name}' already has an import waiting or running for this split.")
