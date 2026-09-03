import importlib
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from django.apps import apps
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob, Project
from datasets_app.services import importing

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_imports(monkeypatch, settings, tmp_path):
    settings.APP_DATA_DIR = tmp_path
    monkeypatch.setattr(importing, "_recovered", True)
    monkeypatch.setattr("datasets_app.views.imports.submit_import", Mock())
    monkeypatch.setattr("datasets.get_dataset_config_names", Mock(return_value=["default"]))
    monkeypatch.setattr("datasets.get_dataset_split_names", Mock(return_value=["train", "valid"]))
    monkeypatch.setattr("datasets.load_dataset", Mock(side_effect=lambda *args, **kwargs: iter([{"repository": args[0]}])))
    monkeypatch.setattr("huggingface_hub.get_token", lambda: None)


@pytest.fixture
def project():
    return Project.objects.create(name="Workspace", source_type="upload")


def start(client, tmp_path, project, source, dataset="B", split="train"):
    payload = {"project_id": project.pk, "split_name": split}
    if dataset is not None:
        payload["dataset_name"] = dataset
    if source == "upload":
        payload["file"] = SimpleUploadedFile("source.jsonl", b'{"text":"upload"}\n')
        return client.post("/api/import/upload/", payload)
    if source == "local":
        path = tmp_path / "source.jsonl"
        path.write_text('{"text":"local"}\n')
        payload["path"] = str(path)
    else:
        payload.update(repository="owner/source", split=split)
    return client.post(f"/api/import/{source}/", json.dumps(payload), content_type="application/json")


@pytest.mark.parametrize("source", ["upload", "local", "huggingface"])
@pytest.mark.parametrize("state", ["data", "protected", "deleted", "pending"])
def test_another_dataset_train_never_blocks_import(client, tmp_path, project, source, state):
    old = DatasetSplit.objects.create(project=project, dataset_name="A", name="train")
    record = DatasetRecord.objects.create(split=old, position=1, current_json={"keep": "A"}, original_json={"keep": "A"})
    if state == "protected":
        old.is_protected = True
        old.save()
    if state == "deleted":
        old.deleted_at = timezone.now()
        old.save()
    if state == "pending":
        ImportJob.objects.create(project=project, source_type="local", source_config={"dataset_name": "A", "split_name": "train"})
    response = start(client, tmp_path, project, source)
    assert response.status_code == 202
    job_id = response.json()["data"]["id"]
    assert response.json()["data"]["datasetName"] == "B"
    importing.run_import_job(job_id)
    assert ImportJob.objects.get(pk=job_id).status == "completed"
    assert project.splits.get(dataset_name="B", name="train").record_count == 1
    record.refresh_from_db()
    assert record.current_json == {"keep": "A"}
    assert old.records.count() == 1


@pytest.mark.parametrize("source", ["upload", "local", "huggingface"])
def test_same_dataset_train_still_rejected_and_upload_file_cleaned(client, tmp_path, project, source):
    old = DatasetSplit.objects.create(project=project, dataset_name="B", name="train")
    DatasetRecord.objects.create(split=old, position=1, current_json={"keep": True})
    response = start(client, tmp_path, project, source)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SPLIT_NOT_EMPTY"
    assert not ImportJob.objects.exists()
    assert not list((tmp_path / "uploads").glob("*"))


@pytest.mark.parametrize("source", ["upload", "local", "huggingface"])
@pytest.mark.parametrize("active_source", ["upload", "local", "huggingface"])
def test_reservations_shared_across_import_methods(client, tmp_path, project, source, active_source):
    ImportJob.objects.create(project=project, source_type=active_source, source_config={"dataset_name": "B", "split_name": "train"})
    response = start(client, tmp_path, project, source)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SPLIT_IMPORT_ACTIVE"
    assert ImportJob.objects.count() == 1


@pytest.mark.parametrize("source,expected", [("upload", "source"), ("local", "source"), ("huggingface", "owner/source")])
def test_names_derived_from_source_and_persisted(client, tmp_path, project, source, expected):
    response = start(client, tmp_path, project, source, dataset=None)
    assert response.status_code == 202
    assert ImportJob.objects.get().source_config["dataset_name"] == expected


def test_multi_split_batch_belongs_to_one_named_dataset(client, project):
    DatasetSplit.objects.create(project=project, dataset_name="existing", name="train", record_count=12)
    response = client.post("/api/import/huggingface/batch/", json.dumps({
        "project_id": project.pk, "repository": "owner/data", "dataset_name": "new dataset", "splits": ["train", "valid"],
    }), content_type="application/json")
    assert response.status_code == 202
    for job in response.json()["data"]["jobs"]:
        assert job["datasetName"] == "new dataset"
        importing.run_import_job(job["id"])
    data = client.get(f"/api/projects/{project.pk}/splits/").json()["data"]
    assert {(item["datasetName"], item["name"]) for item in data} == {
        ("existing", "train"), ("new dataset", "train"), ("new dataset", "valid"),
    }
    resources = client.get("/api/management/resources/").json()["data"]
    assert {item["datasetName"] for item in resources["projects"][0]["splits"]} == {"existing", "new dataset"}


def test_database_uniqueness_is_scoped_to_dataset(project):
    DatasetSplit.objects.create(project=project, dataset_name="A", name="train")
    DatasetSplit.objects.create(project=project, dataset_name="B", name="train")
    with pytest.raises(IntegrityError), transaction.atomic():
        DatasetSplit.objects.create(project=project, dataset_name="A", name="train")


def test_migration_preserves_split_ids_records_and_job_ownership(project):
    split = DatasetSplit.objects.create(project=project, name="train")
    record = DatasetRecord.objects.create(split=split, position=1, current_json={"existing": True})
    completed = ImportJob.objects.create(project=project, source_type="upload", status="completed", source_config={"filename": "existing.jsonl", "split_name": "train"})
    other = ImportJob.objects.create(project=project, source_type="huggingface", status="failed", source_config={"repository": "owner/new", "split": "train"})
    migration = importlib.import_module("datasets_app.migrations.0003_dataset_split_namespace")
    migration.populate_dataset_names(apps, SimpleNamespace(connection=connection))
    split.refresh_from_db()
    record.refresh_from_db()
    completed.refresh_from_db()
    other.refresh_from_db()
    assert split.dataset_name == "existing"
    assert record.split_id == split.pk
    assert record.current_json == {"existing": True}
    assert completed.source_config["dataset_name"] == "existing"
    assert other.source_config["dataset_name"] == "owner/new"


def test_recovery_cleans_only_interrupted_dataset(project, monkeypatch):
    first = DatasetSplit.objects.create(project=project, dataset_name="A", name="train", record_count=1)
    kept = DatasetRecord.objects.create(split=first, position=1, current_json={"keep": True})
    second = DatasetSplit.objects.create(project=project, dataset_name="B", name="train")
    partial = DatasetRecord.objects.create(split=second, position=1, current_json={"partial": True})
    job = ImportJob.objects.create(project=project, source_type="local", status="running", source_config={
        "dataset_name": "B", "split_name": "train", "_record_ranges": [[partial.pk, partial.pk]],
    })
    monkeypatch.setattr(importing, "_recovered", False)
    monkeypatch.setattr(importing, "_process_started_at", timezone.now())
    importing.recover_import_jobs()
    assert DatasetRecord.objects.filter(pk=kept.pk).exists()
    assert not DatasetRecord.objects.filter(pk=partial.pk).exists()
    job.refresh_from_db()
    assert job.status == "interrupted"
