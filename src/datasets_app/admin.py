from django.contrib import admin

from .models import DatasetRecord, DatasetSplit, ImportJob, Project, RecordValidation


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "source_type", "created_at", "updated_at")
    list_filter = ("source_type",)
    search_fields = ("name",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(DatasetSplit)
class DatasetSplitAdmin(admin.ModelAdmin):
    list_display = ("name", "dataset_name", "project", "record_count", "position")
    list_filter = ("project",)
    search_fields = ("name", "dataset_name", "project__name")


@admin.register(DatasetRecord)
class DatasetRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "split", "position", "status", "is_deleted", "version")
    list_filter = ("status", "is_deleted", "split")
    search_fields = ("search_text",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "source_type", "status", "progress_current", "created_at")
    list_filter = ("status", "source_type")
    readonly_fields = ("created_at", "started_at", "finished_at")


@admin.register(RecordValidation)
class RecordValidationAdmin(admin.ModelAdmin):
    list_display = ("record", "severity", "code", "json_path", "created_at")
    list_filter = ("severity", "code")
    search_fields = ("message", "json_path")
