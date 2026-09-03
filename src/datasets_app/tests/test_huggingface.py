import json
from datetime import timedelta
from unittest.mock import Mock

import pytest
from django.utils import timezone
from httpx import ConnectError, Request, Response
from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError, RevisionNotFoundError

from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob, Project
from datasets_app.services import importing
from datasets_app.services.huggingface import public_error, resolve_token

pytestmark = pytest.mark.django_db


@pytest.fixture
def hf(monkeypatch):
    configs = Mock(return_value=["default"])
    splits = Mock(return_value=["train", "valid"])
    load = Mock(side_effect=lambda *args, **kwargs: iter([{"text": kwargs["split"]}]))
    submit = Mock()
    monkeypatch.setattr("datasets.get_dataset_config_names", configs)
    monkeypatch.setattr("datasets.get_dataset_split_names", splits)
    monkeypatch.setattr("datasets.load_dataset", load)
    monkeypatch.setattr("huggingface_hub.get_token", lambda: None)
    monkeypatch.setattr("datasets_app.views.imports.submit_import", submit)
    monkeypatch.setattr(importing, "_recovered", True)
    return configs, splits, load, submit


@pytest.fixture
def project():
    return Project.objects.create(name="HF", source_type="huggingface")


def post(client, path, **payload):
    return client.post(f"/api/{path}/", json.dumps(payload), content_type="application/json")


def batch(client, project, **overrides):
    return post(client, "import/huggingface/batch", **{
        "project_id": project.pk, "repository": "owner/data", "splits": ["train", "valid"], **overrides,
    })


def test_info_auto_config_and_exact_split_names(client, hf):
    configs, splits, _, _ = hf
    response = post(client, "huggingface/info", repository="owner/data", revision="v1", hf_token="hf_browser")
    assert response.status_code == 200
    assert response.json()["data"] == {
        "repository": "owner/data", "configurations": ["default"], "configuration": "default", "splits": ["train", "valid"],
    }
    configs.assert_called_once_with("owner/data", revision="v1", token="hf_browser")
    splits.assert_called_once_with("owner/data", config_name="default", revision="v1", token="hf_browser")
    assert "hf_browser" not in response.content.decode()


def test_multiple_configs_require_selection_and_validation_only(client, hf):
    configs, splits, _, _ = hf
    configs.return_value = ["en", "ja"]
    response = post(client, "huggingface/info", repository="owner/data")
    assert response.json()["data"]["configuration"] is None
    splits.assert_not_called()
    splits.return_value = ["validation"]
    response = post(client, "huggingface/info", repository="owner/data", configuration="ja")
    assert response.json()["data"]["splits"] == ["validation"]
    response = post(client, "huggingface/info", repository="owner/data", configuration="missing")
    assert response.json()["error"]["code"] == "HF_CONFIGURATION_INVALID"


def test_batch_streaming_auth_and_schema(client, project, hf, django_capture_on_commit_callbacks):
    _, _, load, submit = hf
    with django_capture_on_commit_callbacks(execute=True):
        response = batch(client, project, revision="v1", hf_token="hf_browser")
    assert response.status_code == 202
    jobs = response.json()["data"]["jobs"]
    assert [job["split"] for job in jobs] == ["train", "valid"]
    assert submit.call_count == 2
    load.side_effect = lambda *args, **kwargs: iter([{kwargs["split"]: "hello"}])
    for call in submit.call_args_list:
        assert call.kwargs == {"hf_token": "hf_browser"}
        importing.run_import_job(call.args[0].pk, **call.kwargs)
    assert set(project.splits.values_list("name", "record_count")) == {("train", 1), ("valid", 1)}
    project.refresh_from_db()
    assert project.inferred_schema["record_count"] == 2
    assert set(project.inferred_schema["fields"]) == {"train", "valid"}
    for call in load.call_args_list:
        assert call.kwargs["token"] == "hf_browser"
        assert call.kwargs["revision"] == "v1"
        assert call.kwargs["streaming"] is True
        assert call.args == ("owner/data", "default")
    for job in ImportJob.objects.all():
        assert job.status == "completed"
        assert "hf_token" not in job.source_config
        assert "hf_browser" not in json.dumps(job.source_config)
        assert "hf_browser" not in client.get(f"/api/jobs/{job.pk}/").content.decode()


def test_legacy_single_split_api_and_get_info(client, project, hf, monkeypatch, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = post(client, "import/huggingface", project_id=project.pk, repository="owner/data", split="valid", split_name="evaluation", hf_token="hf_test")
    assert response.status_code == 202
    assert "id" in response.json()["data"]
    assert ImportJob.objects.get().source_config["split_name"] == "evaluation"
    monkeypatch.setattr("huggingface_hub.HfApi.dataset_info", Mock(return_value=Mock(siblings=[Mock(rfilename="data.jsonl")], tags=["text"])))
    response = client.get("/api/huggingface/info/?repository=owner/data")
    assert response.json()["data"] == {"repository": "owner/data", "files": ["data.jsonl"], "tags": ["text"]}


@pytest.mark.parametrize("kwargs,code", [
    ({"splits": []}, "VALIDATION_ERROR"),
    ({"splits": ["train", "train"]}, "HF_SPLIT_INVALID"),
    ({"splits": ["missing"]}, "HF_SPLIT_INVALID"),
    ({"configuration": "missing"}, "HF_CONFIGURATION_INVALID"),
])
def test_invalid_selection_creates_no_jobs(client, project, hf, kwargs, code):
    response = batch(client, project, **kwargs)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert not ImportJob.objects.exists()


@pytest.mark.parametrize("state", ["data", "protected", "deleted", "pending", "running"])
def test_target_conflicts_are_atomic(client, project, hf, state):
    target = DatasetSplit.objects.create(project=project, dataset_name="owner/data", name="valid")
    if state == "data":
        DatasetRecord.objects.create(split=target, position=1, original_json={"keep": 1}, current_json={"keep": 1})
    elif state == "protected":
        target.is_protected = True
        target.save()
    elif state == "deleted":
        target.deleted_at = timezone.now()
        target.save()
    else:
        ImportJob.objects.create(project=project, source_type="local", status=state, source_config={"dataset_name": "owner/data", "split_name": "valid"})
    before = ImportJob.objects.count()
    response = batch(client, project)
    assert response.status_code == 409
    assert ImportJob.objects.count() == before
    hf[3].assert_not_called()


def test_failed_split_cleans_own_rows_and_retry_preserves_success(client, project, hf, monkeypatch):
    monkeypatch.setattr(importing, "BATCH_SIZE", 1)
    secret = "hf_not_in_errors"
    def records(*args, **kwargs):
        yield {"text": "first"}
        if kwargs["split"] == "valid":
            raise RuntimeError(f"Authorization: Bearer {secret}")
    hf[2].side_effect = records
    response = batch(client, project, hf_token=secret)
    jobs = response.json()["data"]["jobs"]
    for job in jobs:
        importing.run_import_job(job["id"], secret)
    assert project.splits.get(name="train").record_count == 1
    assert project.splits.get(name="valid").records.count() == 0
    failed = ImportJob.objects.get(pk=jobs[1]["id"])
    assert failed.status == "failed"
    assert secret not in json.dumps(failed.error)
    assert secret not in client.get(f"/api/jobs/{failed.pk}/").content.decode()
    hf[2].side_effect = lambda *args, **kwargs: iter([{"answer": "retry"}])
    retry = batch(client, project, splits=["valid"])
    assert retry.status_code == 202
    importing.run_import_job(retry.json()["data"]["jobs"][0]["id"])
    assert DatasetRecord.objects.count() == 2
    project.refresh_from_db()
    assert project.inferred_schema["record_count"] == 2


def test_worker_rechecks_destination_and_does_not_delete_existing(project, hf):
    target = DatasetSplit.objects.create(project=project, dataset_name="owner/data", name="train")
    record = DatasetRecord.objects.create(split=target, position=1, current_json={"existing": True})
    job = ImportJob.objects.create(project=project, source_type="huggingface", source_config={"repository": "owner/data", "split": "train"})
    importing.run_import_job(job.pk)
    assert DatasetRecord.objects.filter(pk=record.pk).exists()
    job.refresh_from_db()
    assert job.status == "failed"
    hf[2].assert_not_called()


def test_failure_does_not_remove_records_added_by_another_writer(project, hf, monkeypatch):
    monkeypatch.setattr(importing, "BATCH_SIZE", 1)
    def records(*args, **kwargs):
        yield {"imported": True}
        target = project.splits.get(name="train")
        DatasetRecord.objects.create(split=target, position=99, current_json={"manual": True})
        raise RuntimeError("fail after insert")
    hf[2].side_effect = records
    job = ImportJob.objects.create(project=project, source_type="huggingface", source_config={"repository": "owner/data", "split": "train"})
    importing.run_import_job(job.pk)
    assert list(DatasetRecord.objects.values_list("current_json", flat=True)) == [{"manual": True}]


def test_credentials_priority_isolation_and_redaction(client, project, hf, monkeypatch, caplog):
    monkeypatch.setattr("huggingface_hub.get_token", lambda: "hf_server")
    assert resolve_token(" hf_browser ") == "hf_browser"
    assert resolve_token("  ") == "hf_server"
    for token in ["hf_one", "hf_two", None]:
        response = post(client, "huggingface/info", repository="owner/data", hf_token=token)
        assert response.status_code == 200
        assert hf[0].call_args.kwargs["token"] == (token or "hf_server")
    for token in [{"secret": "hf_do_not_echo"}, ["hf_do_not_echo"]]:
        response = batch(client, project, hf_token=token)
        assert response.status_code == 422
        assert "hf_do_not_echo" not in response.content.decode()
    hf[0].side_effect = RuntimeError("hf_do_not_echo")
    response = post(client, "huggingface/info", repository="owner/data", hf_token="hf_do_not_echo")
    assert response.status_code == 422
    assert "hf_do_not_echo" not in response.content.decode()
    assert "hf_do_not_echo" not in caplog.text


@pytest.mark.parametrize("exception,code", [
    (GatedRepoError("secret", response=Response(403, request=Request("GET", "https://huggingface.co/test"))), "HF_ACCESS_DENIED"),
    (RepositoryNotFoundError("secret", response=Response(404, request=Request("GET", "https://huggingface.co/test"))), "HF_REPOSITORY_UNAVAILABLE"),
    (RevisionNotFoundError("secret", response=Response(404, request=Request("GET", "https://huggingface.co/test"))), "HF_REVISION_NOT_FOUND"),
    (ConnectError("secret"), "HF_CONNECTION_ERROR"),
    (TypeError("secret"), "HF_UNSUPPORTED_DATASET"),
])
def test_safe_error_categories(exception, code):
    result = public_error(exception)
    assert result["code"] == code
    assert "secret" not in result["message"]


def test_public_without_token_and_non_json_record(project, hf):
    job = ImportJob.objects.create(project=project, source_type="huggingface", source_config={"repository": "owner/data", "split": "train"})
    hf[2].side_effect = lambda *args, **kwargs: iter([{"bytes": b"unsupported"}])
    importing.run_import_job(job.pk)
    assert hf[2].call_args.kwargs["token"] is None
    job.refresh_from_db()
    assert job.error["code"] == "HF_UNSUPPORTED_DATASET"
    assert not DatasetRecord.objects.exists()


def test_recovery_marks_only_previous_process_jobs(client, project, hf, monkeypatch):
    old = [ImportJob.objects.create(project=project, source_type="huggingface", status=status) for status in ["pending", "running"]]
    ImportJob.objects.filter(pk__in=[job.pk for job in old]).update(created_at=timezone.now() - timedelta(hours=1))
    monkeypatch.setattr(importing, "_process_started_at", timezone.now())
    new = ImportJob.objects.create(project=project, source_type="huggingface")
    monkeypatch.setattr(importing, "_recovered", False)
    response = client.get(f"/api/jobs/{old[0].pk}/")
    assert response.json()["data"]["status"] == "interrupted"
    assert ImportJob.objects.filter(pk__in=[job.pk for job in old], status="interrupted").count() == 2
    new.refresh_from_db()
    assert new.status == "pending"


def test_restart_cleans_journaled_rows_and_allows_retry(client, project, hf, monkeypatch):
    monkeypatch.setattr(importing, "BATCH_SIZE", 1)
    def crash(*args, **kwargs):
        yield {"partial": True}
        raise KeyboardInterrupt()
    hf[2].side_effect = crash
    response = batch(client, project, splits=["train"])
    job_id = response.json()["data"]["jobs"][0]["id"]
    with pytest.raises(KeyboardInterrupt):
        importing.run_import_job(job_id, "hf_ephemeral")
    interrupted = ImportJob.objects.get(pk=job_id)
    assert interrupted.source_config["_record_ranges"]
    assert "hf_ephemeral" not in json.dumps(interrupted.source_config)
    monkeypatch.setattr(importing, "_process_started_at", timezone.now())
    monkeypatch.setattr(importing, "_recovered", False)
    response = client.get(f"/api/jobs/{job_id}/")
    assert response.json()["data"]["status"] == "interrupted"
    assert not DatasetRecord.objects.exists()
    assert batch(client, project, splits=["train"]).status_code == 202


@pytest.mark.django_db(transaction=True)
def test_real_worker_processes_committed_batch_and_continues_after_failure(client, project, hf, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    def records(*args, **kwargs):
        if kwargs["split"] == "train":
            raise RuntimeError("hf_private_error")
        return iter([{"valid": True}])
    hf[2].side_effect = records
    monkeypatch.setattr("datasets_app.views.imports.submit_import", importing.submit_import)
    with ThreadPoolExecutor(max_workers=1) as executor:
        monkeypatch.setattr(importing, "_executor", executor)
        response = batch(client, project, hf_token="hf_browser")
        assert response.status_code == 202
    assert list(ImportJob.objects.order_by("id").values_list("status", flat=True)) == ["failed", "completed"]
    assert project.splits.get(name="valid").record_count == 1
    assert all(call.kwargs["token"] == "hf_browser" for call in hf[2].call_args_list)


def test_schema_includes_other_valid_splits_but_excludes_deleted_data(project, hf):
    existing = DatasetSplit.objects.create(project=project, name="existing")
    deleted = DatasetSplit.objects.create(project=project, name="deleted", deleted_at=timezone.now())
    for target, value, is_deleted in [(existing, {"kept": 1}, False), (existing, {"removed": 1}, True), (deleted, {"hidden": 1}, False)]:
        DatasetRecord.objects.create(split=target, position=target.records.count() + 1, current_json=value, is_deleted=is_deleted)
    job = ImportJob.objects.create(project=project, source_type="huggingface", source_config={"repository": "owner/data", "split": "train"})
    importing.run_import_job(job.pk)
    project.refresh_from_db()
    assert set(project.inferred_schema["fields"]) == {"kept", "text"}
    assert project.inferred_schema["record_count"] == 2
