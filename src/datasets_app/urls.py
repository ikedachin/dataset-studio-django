from django.urls import path

from .views import exports, imports, projects, records

urlpatterns = [
    path("projects/", projects.projects),
    path("projects/<int:project_id>/", projects.project_detail),
    path("projects/<int:project_id>/splits/", projects.project_splits),
    path("projects/<int:project_id>/validate/", projects.project_validate),
    path("splits/<int:split_id>/records/", records.split_records),
    path("records/<int:record_id>/", records.record),
    path("records/<int:record_id>/duplicate/", records.duplicate),
    path("records/<int:record_id>/restore/", records.restore),
    path("records/<int:record_id>/revert/", records.revert),
    path("records/<int:record_id>/diff/", records.diff),
    path("records/<int:record_id>/validate/", records.validate),
    path("records/<int:record_id>/sync/", records.sync),
    path("import/upload/", imports.import_upload),
    path("import/local/", imports.import_local),
    path("import/huggingface/", imports.import_huggingface),
    path("import/huggingface/batch/", imports.import_huggingface_batch),
    path("huggingface/info/", imports.huggingface_info),
    path("jobs/<int:job_id>/", imports.job_detail),
    path("export/download/", exports.export_download),
    path("export/path/", exports.export_path),
]
