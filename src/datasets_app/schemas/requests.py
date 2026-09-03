from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


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
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: int
    path: str
    split_name: str = Field(default="train", min_length=1, max_length=120)
    dataset_name: str | None = Field(default=None, min_length=1, max_length=255)


class UploadImport(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: int
    split_name: str = Field(default="train", min_length=1, max_length=120)
    dataset_name: str | None = Field(default=None, min_length=1, max_length=255)


SplitName = Annotated[str, Field(min_length=1, max_length=120)]


class HuggingFaceInfo(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    repository: str = Field(min_length=1, max_length=200, pattern=r"^[\w.-]+(?:/[\w.-]+)?$")
    revision: str | None = None
    configuration: str | None = None
    hf_token: SecretStr | None = Field(default=None, exclude=True, repr=False)


class HuggingFaceImport(HuggingFaceInfo):
    project_id: int
    dataset_name: str | None = Field(default=None, min_length=1, max_length=255)
    split: SplitName = "train"
    split_name: SplitName | None = None


class HuggingFaceBatchImport(HuggingFaceInfo):
    project_id: int
    dataset_name: str | None = Field(default=None, min_length=1, max_length=255)
    splits: list[SplitName] = Field(min_length=1)


class ExportPath(BaseModel):
    split_id: int
    path: str
    overwrite: bool = False


class SyncRequest(BaseModel):
    version: int
    apply: bool = False
