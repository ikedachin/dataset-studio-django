from typing import Any, Literal

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    source_type: Literal["upload", "local", "huggingface"] = "upload"


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sync_rules: list[dict[str, str]] | None = None
    identifier_fields: list[str] | None = None
    validation_settings: dict[str, Any] | None = None


class RecordUpdate(BaseModel):
    version: int = Field(ge=1)
    data: dict[str, Any]


class RecordCreate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class LocalImport(BaseModel):
    project_id: int
    path: str
    split_name: str = "train"


class HuggingFaceImport(BaseModel):
    project_id: int
    repository: str
    revision: str | None = None
    configuration: str | None = None
    split: str = "train"
    split_name: str | None = None


class ExportPath(BaseModel):
    split_id: int
    path: str
    overwrite: bool = False


class SyncRequest(BaseModel):
    version: int
    apply: bool = False
