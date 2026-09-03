from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob, Project


def project_data(project: Project) -> dict:
    return {
        "id": project.pk,
        "name": project.name,
        "sourceType": project.source_type,
        "sourceMetadata": project.source_metadata,
        "inferredSchema": project.inferred_schema,
        "syncRules": project.sync_rules,
        "identifierFields": project.identifier_fields,
        "validationSettings": project.validation_settings,
        "createdAt": project.created_at.isoformat(),
        "updatedAt": project.updated_at.isoformat(),
    }


def split_data(split: DatasetSplit) -> dict:
    return {"id": split.pk, "name": split.name, "datasetName": split.dataset_name, "position": split.position, "recordCount": split.record_count}


def record_summary(record: DatasetRecord) -> dict:
    preview = next((str(v).replace("\n", " ")[:100] for v in record.current_json.values() if isinstance(v, (str, int, float))), "{}")
    status = "deleted" if record.is_deleted else record.status
    return {
        "id": record.pk,
        "position": record.position,
        "status": status,
        "preview": preview,
        "validationErrors": record.validation_error_count,
        "validationWarnings": record.validation_warning_count,
    }


def record_detail(record: DatasetRecord) -> dict:
    return {
        **record_summary(record),
        "splitId": record.split_id,
        "original": record.original_json,
        "data": record.current_json,
        "isNew": record.is_new,
        "isDeleted": record.is_deleted,
        "version": record.version,
        "updatedAt": record.updated_at.isoformat(),
    }


def job_data(job: ImportJob) -> dict:
    percent = None
    if job.progress_total:
        percent = round(job.progress_current / job.progress_total * 100, 1)
    return {
        "id": job.pk,
        "projectId": job.project_id,
        "datasetName": job.source_config.get("dataset_name"),
        "status": job.status,
        "current": job.progress_current,
        "total": job.progress_total,
        "percent": percent,
        "error": job.error,
    }
