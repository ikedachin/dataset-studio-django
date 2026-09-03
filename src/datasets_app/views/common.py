from __future__ import annotations

import json
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

from django.http import HttpRequest, JsonResponse
from pydantic import BaseModel, ValidationError

Schema = TypeVar("Schema", bound=BaseModel)


def success(data: Any, status: int = 200) -> JsonResponse:
    return JsonResponse({"data": data}, status=status, safe=False)


def error(code: str, message: str, status: int = 400, details: Any = None) -> JsonResponse:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    return JsonResponse({"error": payload}, status=status)


def body_as(request: HttpRequest, schema: type[Schema]) -> Schema:
    try:
        raw = json.loads(request.body or b"{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Request body is not valid JSON") from exc
    return schema.model_validate(raw)


def api_errors(view: Callable[..., JsonResponse]):
    @wraps(view)
    def wrapper(*args: Any, **kwargs: Any) -> JsonResponse:
        try:
            return view(*args, **kwargs)
        except ValidationError as exc:
            return error("VALIDATION_ERROR", "Request validation failed", 422, exc.errors(include_url=False, include_input=False, include_context=False))
        except ValueError as exc:
            return error("INVALID_REQUEST", str(exc), 400)
    return wrapper
