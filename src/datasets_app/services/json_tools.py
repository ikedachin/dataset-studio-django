from __future__ import annotations

from collections.abc import Iterator
from typing import Any


def flatten_scalars(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for item in value.values():
            yield from flatten_scalars(item)
    elif isinstance(value, list):
        for item in value:
            yield from flatten_scalars(item)
    elif value is not None:
        yield str(value)


def search_text(value: dict[str, Any]) -> str:
    return "\n".join(flatten_scalars(value))


def parse_path(path: str) -> list[str | int]:
    """Parse safe dotted paths with optional numeric brackets."""
    if not path or len(path) > 500:
        raise ValueError("Invalid JSON path")
    parts: list[str | int] = []
    for segment in path.split("."):
        if not segment:
            raise ValueError("Invalid JSON path")
        while "[" in segment:
            name, bracket = segment.split("[", 1)
            if name:
                parts.append(name)
            index, remainder = bracket.split("]", 1)
            if not index.isdigit():
                raise ValueError("Array indices must be numeric")
            parts.append(int(index))
            segment = remainder
        if segment:
            parts.append(segment)
    if any(isinstance(p, str) and not p.replace("_", "").replace("-", "").isalnum() for p in parts):
        raise ValueError("Invalid JSON path")
    return parts


def get_path(data: Any, path: str, missing: Any = None) -> Any:
    current = data
    for part in parse_path(path):
        try:
            current = current[part]
        except (KeyError, IndexError, TypeError):
            return missing
    return current


def set_path(data: Any, path: str, value: Any) -> None:
    parts = parse_path(path)
    if not parts:
        raise ValueError("Path cannot be empty")
    current = data
    for part in parts[:-1]:
        current = current[part]
    current[parts[-1]] = value


def json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"
