import json

import pytest
from django.contrib import admin
from django.test import Client

from datasets_app.models import DatasetRecord, DatasetSplit, ImportJob, Project
from datasets_app.services.diffing import structural_diff
from datasets_app.services.exporting import iter_export
from datasets_app.services.importing import run_import_job
from datasets_app.services.syncing import preview_sync
from datasets_app.services.validation import validate_project, validate_record


@pytest.fixture
def project(db):
    return Project.objects.create(name="Example", source_type="local")


@pytest.fixture
def split(project):
    return DatasetSplit.objects.create(project=project, name="train")


def make_record(split, position=1, data=None):
    value = data or {"id": str(position), "text": "今治市"}
    return DatasetRecord.objects.create(
        split=split,
        position=position,
        original_json=value,
        current_json=value,
        search_text="\n".join(str(v) for v in value.values()),
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "records",
    [
        [{"text": "hello"}],
        [{"text": "日本語のデータ"}],
        [{"metadata": {"score": 0.92}, "tags": ["ja"]}],
        [{"messages": [{"role": "user", "content": "質問"}]}],
        [{"items": [{"label": "A"}, {"label": "B"}]}],
    ],
)
def test_streaming_import_formats(tmp_path, records):
    source = tmp_path / "train.jsonl"
    source.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records), encoding="utf-8")
    project = Project.objects.create(name="Import", source_type="local")
    job = ImportJob.objects.create(
        project=project,
        source_type="local",
        source_config={"path": str(source), "split_name": "train"},
    )
    run_import_job(job.pk)
    job.refresh_from_db()
    assert job.status == "completed"
    assert DatasetRecord.objects.get().current_json == records[0]
    assert project.splits.get().record_count == len(records)


@pytest.mark.django_db
@pytest.mark.parametrize("line", ["not-json\n", "[1,2]\n", '"hello"\n'])
def test_invalid_import_fails_without_partial_data(tmp_path, line):
    source = tmp_path / "bad.jsonl"
    source.write_text('{"ok":true}\n' + line, encoding="utf-8")
    project = Project.objects.create(name="Bad", source_type="local")
    job = ImportJob.objects.create(project=project, source_type="local", source_config={"path": str(source)})
    run_import_job(job.pk)
    job.refresh_from_db()
    assert job.status == "failed"
    assert job.error["line"] == 2
    assert DatasetRecord.objects.count() == 0


@pytest.mark.django_db
def test_crud_and_optimistic_concurrency(client: Client, split):
    created = client.post(
        f"/api/splits/{split.pk}/records/",
        data=json.dumps({"data": {"question": "old"}}),
        content_type="application/json",
    )
    assert created.status_code == 201
    record = created.json()["data"]
    updated = client.patch(
        f"/api/records/{record['id']}/",
        data=json.dumps({"version": 1, "data": {"question": "new"}}),
        content_type="application/json",
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["version"] == 2
    stale = client.patch(
        f"/api/records/{record['id']}/",
        data=json.dumps({"version": 1, "data": {"question": "lost"}}),
        content_type="application/json",
    )
    assert stale.status_code == 409
    deleted = client.delete(f"/api/records/{record['id']}/")
    assert deleted.json()["data"]["isDeleted"] is True
    restored = client.post(f"/api/records/{record['id']}/restore/")
    assert restored.json()["data"]["isDeleted"] is False
    duplicated = client.post(f"/api/records/{record['id']}/duplicate/")
    assert duplicated.status_code == 201
    assert duplicated.json()["data"]["data"] == {"question": "new"}


@pytest.mark.django_db
def test_search_nested_and_filters(client: Client, split):
    record = make_record(split, data={"metadata": {"source": "Wikipedia", "score": 0.92}})
    record.search_text = "Wikipedia\n0.92"
    record.save(update_fields=["search_text"])
    found = client.get(f"/api/splits/{split.pk}/records/?search=Wikipedia")
    assert found.json()["data"]["total"] == 1
    filters = json.dumps([{"path": "metadata.score", "operator": "gte", "value": 0.9}])
    filtered = client.get(f"/api/splits/{split.pk}/records/", {"filters": filters})
    assert filtered.json()["data"]["total"] == 1


@pytest.mark.django_db
def test_diff_sync_and_validation(project, split):
    project.sync_rules = [{"target": "messages[0].content", "template": "{{ question }} / {{ answer }}"}]
    project.validation_settings = {"required_fields": ["answer"]}
    project.inferred_schema = {"fields": {"score": {"float_count": 2}}}
    project.save()
    data = {"id": "same", "question": "Q", "answer": "A", "score": "bad", "messages": [{"role": "user", "content": "old"}]}
    first = make_record(split, 1, data)
    second = make_record(split, 2, {"id": "same", "messages": [{"role": 1}]})
    preview = preview_sync(data, project.sync_rules)
    assert preview["data"]["messages"][0]["content"] == "Q / A"
    first.current_json = {**data, "answer": "changed"}
    assert structural_diff(first.original_json, first.current_json)[0]["path"] == "$.answer"
    issues = validate_record(second)
    assert {issue["code"] for issue in issues} >= {"REQUIRED_MISSING", "INVALID_MESSAGE"}
    summary = validate_project(project)
    assert summary["errors"] >= 2
    assert first.validations.filter(code="DUPLICATE_IDENTIFIER").exists()


@pytest.mark.django_db
def test_sync_creates_missing_message_targets(project, split):
    project.sync_rules = [
        {"source": "question", "target": "messages[0].content"},
        {"template": "\n{{ answer }}", "target": "messages[1].content"},
    ]
    project.save()
    data = {"question": "Q", "thinking": "T", "answer": "A"}
    preview = preview_sync(data, project.sync_rules)
    assert preview["data"]["messages"][0]["content"] == "Q"
    assert preview["data"]["messages"][1]["content"] == "\nA"


@pytest.mark.django_db
def test_export_unicode_order_deleted_and_trailing_newline(split):
    make_record(split, 2, {"text": "二"})
    make_record(split, 1, {"text": "一"})
    deleted = make_record(split, 3, {"text": "削除"})
    deleted.is_deleted = True
    deleted.save()
    new = make_record(split, 4, {"text": "新規"})
    new.is_new = True
    new.save()
    output = b"".join(iter_export(split)).decode()
    assert output.splitlines() == ['{"text":"一"}', '{"text":"二"}', '{"text":"新規"}']
    assert output.endswith("\n")
    assert "\\u" not in output


@pytest.mark.django_db
def test_admin_models_registered():
    assert Project in admin.site._registry
    assert DatasetSplit in admin.site._registry
    assert DatasetRecord in admin.site._registry
    assert ImportJob in admin.site._registry
