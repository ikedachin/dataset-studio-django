from django.db import models


def default_identifier_fields() -> list[str]:
    return ["id", "qa_id", "uuid"]


class Project(models.Model):
    class SourceType(models.TextChoices):
        UPLOAD = "upload", "Browser upload"
        LOCAL = "local", "Local path"
        HUGGINGFACE = "huggingface", "Hugging Face"

    name = models.CharField(max_length=255)
    source_type = models.CharField(max_length=20, choices=SourceType.choices)
    source_metadata = models.JSONField(default=dict, blank=True)
    inferred_schema = models.JSONField(default=dict, blank=True)
    sync_rules = models.JSONField(default=list, blank=True)
    identifier_fields = models.JSONField(default=default_identifier_fields, blank=True)
    validation_settings = models.JSONField(default=dict, blank=True)
    is_protected = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.name


class DatasetSplit(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="splits")
    name = models.CharField(max_length=120)
    position = models.PositiveIntegerField(default=0)
    record_count = models.PositiveIntegerField(default=0)
    is_protected = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["project", "name"], name="unique_split")]

    def __str__(self) -> str:
        return f"{self.project}: {self.name}"


class DatasetRecord(models.Model):
    class Status(models.TextChoices):
        UNEDITED = "unedited", "Unedited"
        EDITED = "edited", "Edited"
        NEW = "new", "New"

    split = models.ForeignKey(DatasetSplit, on_delete=models.CASCADE, related_name="records")
    position = models.BigIntegerField()
    original_json = models.JSONField(default=dict)
    current_json = models.JSONField(default=dict)
    search_text = models.TextField(default="", blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.UNEDITED)
    is_new = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    validation_error_count = models.PositiveIntegerField(default=0)
    validation_warning_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["split", "position"], name="record_split_position"),
            models.Index(fields=["split", "is_deleted"], name="record_split_deleted"),
            models.Index(fields=["updated_at"], name="record_updated"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["split", "position"], name="unique_record_position")
        ]


class ImportJob(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        INTERRUPTED = "interrupted", "Interrupted"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="import_jobs")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    source_type = models.CharField(max_length=20)
    source_config = models.JSONField(default=dict)
    progress_current = models.PositiveBigIntegerField(default=0)
    progress_total = models.PositiveBigIntegerField(null=True, blank=True)
    error = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)


class RecordValidation(models.Model):
    class Severity(models.TextChoices):
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    record = models.ForeignKey(DatasetRecord, on_delete=models.CASCADE, related_name="validations")
    severity = models.CharField(max_length=10, choices=Severity.choices)
    code = models.CharField(max_length=80)
    json_path = models.CharField(max_length=500, blank=True)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["record", "severity"], name="validation_record_sev")]
