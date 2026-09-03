"""Hugging Face access without persisting credentials or exposing upstream errors."""

from __future__ import annotations

from typing import Any

from django.views.decorators.debug import sensitive_variables
from pydantic import SecretStr


class HuggingFaceError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@sensitive_variables()
def resolve_token(value: SecretStr | str | None = None) -> str | None:
    from huggingface_hub import get_token

    token = value.get_secret_value() if isinstance(value, SecretStr) else value
    return (token or "").strip() or get_token()


def public_error(exc: Exception) -> dict[str, str]:
    # Never include str(exc): upstream messages can contain credentials and URLs.
    from datasets.exceptions import DatasetNotFoundError
    from httpx import TransportError
    from huggingface_hub.errors import (
        GatedRepoError,
        HfHubHTTPError,
        RepositoryNotFoundError,
        RevisionNotFoundError,
    )
    from requests.exceptions import RequestException

    if isinstance(exc, HuggingFaceError):
        return {"code": exc.code, "message": str(exc)}
    if isinstance(exc, GatedRepoError):
        code, message = "HF_ACCESS_DENIED", "Access denied. Check HF_TOKEN and request access on Hugging Face if required."
    elif isinstance(exc, RevisionNotFoundError):
        code, message = "HF_REVISION_NOT_FOUND", "Revision not found. Check the branch, tag, or commit."
    elif isinstance(exc, (RepositoryNotFoundError, DatasetNotFoundError)):
        code, message = "HF_REPOSITORY_UNAVAILABLE", "Dataset not found or private. Check the repository ID and HF_TOKEN access."
    elif isinstance(exc, HfHubHTTPError):
        status = getattr(exc.response, "status_code", None)
        if status in {401, 403}:
            code, message = "HF_ACCESS_DENIED", "Authentication or access failed. Check HF_TOKEN and dataset permissions."
        else:
            code, message = "HF_CONNECTION_ERROR", "Hugging Face could not complete the request. Please try again."
    elif isinstance(exc, (TransportError, RequestException, ConnectionError, TimeoutError)):
        code, message = "HF_CONNECTION_ERROR", "Could not connect to Hugging Face. Check the connection and try again."
    elif isinstance(exc, (ValueError, TypeError, NotImplementedError)):
        code, message = "HF_UNSUPPORTED_DATASET", "This dataset format could not be loaded as JSON records. Check its Configuration and supported file format."
    else:
        code, message = "HF_IMPORT_ERROR", "Hugging Face import failed. Check the dataset format and try again."
    return {"code": code, "message": message}


@sensitive_variables()
def dataset_info(repository: str, revision: str | None, configuration: str | None, token: str | None) -> dict[str, Any]:
    from datasets import get_dataset_config_names, get_dataset_split_names
    from huggingface_hub.utils import validate_repo_id

    validate_repo_id(repository)
    options = {"revision": revision or None, "token": token}
    configurations = get_dataset_config_names(repository, **options)
    selected = configuration or (configurations[0] if len(configurations) == 1 else None)
    if selected is not None and selected not in configurations:
        raise HuggingFaceError("HF_CONFIGURATION_INVALID", "Choose an available Configuration.")
    splits = get_dataset_split_names(repository, config_name=selected, **options) if selected else []
    return {"repository": repository, "configurations": configurations, "configuration": selected, "splits": splits}
