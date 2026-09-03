from __future__ import annotations

import json

import pytest
from django.test import Client

from dataset_guard.models import GuardAuditLog
from datasets_app.models import DatasetRecord, DatasetSplit, Project


def _project_confirm(project: Project) -> str:
    return f"default/{project.name}"


@pytest.mark.django_db
def test_protected_project_blocks_existing_mutations(client: Client):
    project = Project.objects.create(name="Guarded", source_type="local")
    split = DatasetSplit.objects.create(project=project, name="train")
    record = DatasetRecord.objects.create(
        split=split,
        position=1,
        original_json={"question": "old"},
        current_json={"question": "old"},
        search_text="old",
    )
    response = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps(
            {
                "action": "protect",
                "confirmation_text": _project_confirm(project),
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200

    project_patch = client.patch(
        f"/api/projects/{project.pk}/",
        data=json.dumps({"name": "changed"}),
        content_type="application/json",
    )
    assert project_patch.status_code == 409
    assert project_patch.json()["error"]["code"] == "PROJECT_PROTECTED"

    record_patch = client.patch(
        f"/api/records/{record.pk}/",
        data=json.dumps({"version": 1, "data": {"question": "new"}}),
        content_type="application/json",
    )
    assert record_patch.status_code == 409
    assert record_patch.json()["error"]["code"] == "SPLIT_PROTECTED"

    split_create = client.post(
        f"/api/splits/{split.pk}/records/",
        data=json.dumps({"data": {"new": True}}),
        content_type="application/json",
    )
    assert split_create.status_code == 409
    assert split_create.json()["error"]["code"] == "SPLIT_PROTECTED"


@pytest.mark.django_db
def test_confirmation_mismatch_rejected_and_logged(client: Client):
    project = Project.objects.create(name="Mismatch", source_type="local")
    response = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps({"action": "soft_delete", "confirmation_text": "wrong/value"}),
        content_type="application/json",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CONFIRMATION_MISMATCH"
    log = GuardAuditLog.objects.get()
    assert log.result == GuardAuditLog.ResultType.REJECTED
    assert log.action == GuardAuditLog.ActionType.SOFT_DELETE


@pytest.mark.django_db
def test_soft_deleted_resources_hidden_from_normal_lists(client: Client):
    project = Project.objects.create(name="Visible", source_type="local")
    split = DatasetSplit.objects.create(project=project, name="train")
    response = client.post(
        f"/api/management/splits/{split.pk}/actions/",
        data=json.dumps({"action": "soft_delete", "confirmation_text": split.name}),
        content_type="application/json",
    )
    assert response.status_code == 200
    split_listing = client.get(f"/api/projects/{project.pk}/splits/")
    assert split_listing.status_code == 200
    assert split_listing.json()["data"] == []

    response = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps(
            {"action": "soft_delete", "confirmation_text": _project_confirm(project)}
        ),
        content_type="application/json",
    )
    assert response.status_code == 200
    projects_listing = client.get("/api/projects/")
    assert projects_listing.status_code == 200
    assert projects_listing.json()["data"] == []

    resources = client.get("/api/management/resources/")
    assert resources.status_code == 200
    assert resources.json()["data"]["deletedProjects"][0]["id"] == project.pk


@pytest.mark.django_db
def test_hard_delete_executes_immediately(client: Client):
    project = Project.objects.create(name="Immediate", source_type="local")
    split = DatasetSplit.objects.create(project=project, name="train")
    response = client.post(
        f"/api/management/splits/{split.pk}/actions/",
        data=json.dumps({"action": "hard_delete", "confirmation_text": split.name}),
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True
    assert not DatasetSplit.objects.filter(pk=split.pk).exists()

    project2 = Project.objects.create(name="ImmediateProject", source_type="local")
    split2 = DatasetSplit.objects.create(project=project2, name="eval")
    project_delete = client.post(
        f"/api/management/projects/{project2.pk}/actions/",
        data=json.dumps(
            {
                "action": "hard_delete",
                "confirmation_text": _project_confirm(project2),
            }
        ),
        content_type="application/json",
    )
    assert project_delete.status_code == 200
    assert not Project.objects.filter(pk=project2.pk).exists()
    assert not DatasetSplit.objects.filter(pk=split2.pk).exists()


@pytest.mark.django_db
def test_audit_logs_created_for_operations(client: Client):
    project = Project.objects.create(name="Audit", source_type="local")
    protect = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps({"action": "protect", "confirmation_text": _project_confirm(project)}),
        content_type="application/json",
    )
    assert protect.status_code == 200
    unprotect = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps(
            {"action": "unprotect", "confirmation_text": _project_confirm(project)}
        ),
        content_type="application/json",
    )
    assert unprotect.status_code == 200
    logs = client.get("/api/management/audit-logs/")
    assert logs.status_code == 200
    entries = logs.json()["data"]
    assert len(entries) >= 2
    assert entries[0]["targetType"] == "project"
    assert entries[0]["actor"] == "local-user"


@pytest.mark.django_db
def test_project_protection_applies_to_splits(client: Client):
    project = Project.objects.create(name="Cascade", source_type="local")
    split = DatasetSplit.objects.create(project=project, name="train")
    response = client.post(
        f"/api/management/projects/{project.pk}/actions/",
        data=json.dumps({"action": "protect", "confirmation_text": _project_confirm(project)}),
        content_type="application/json",
    )
    assert response.status_code == 200
    split_delete = client.post(
        f"/api/management/splits/{split.pk}/actions/",
        data=json.dumps({"action": "soft_delete", "confirmation_text": split.name}),
        content_type="application/json",
    )
    assert split_delete.status_code == 409
    assert split_delete.json()["error"]["code"] == "SPLIT_PROTECTED"
