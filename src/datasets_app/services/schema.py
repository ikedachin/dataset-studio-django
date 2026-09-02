from __future__ import annotations

from collections import defaultdict
from typing import Any

from .json_tools import json_type


class SchemaProfiler:
    def __init__(self, sample_limit: int = 5) -> None:
        self.total = 0
        self.sample_limit = sample_limit
        self.stats: dict[str, dict[str, Any]] = defaultdict(self._new_stats)

    @staticmethod
    def _new_stats() -> dict[str, Any]:
        return {
            "count": 0,
            "null_count": 0,
            "string_count": 0,
            "integer_count": 0,
            "float_count": 0,
            "boolean_count": 0,
            "object_count": 0,
            "array_count": 0,
            "max_string_length": 0,
            "multiline_count": 0,
            "samples": [],
        }

    def observe(self, record: dict[str, Any]) -> None:
        self.total += 1
        self._walk(record, "")

    def _walk(self, value: Any, path: str) -> None:
        if path:
            stats = self.stats[path]
            kind = json_type(value)
            stats["count"] += 1
            stats[f"{kind}_count"] += 1
            if isinstance(value, str):
                stats["max_string_length"] = max(stats["max_string_length"], len(value))
                stats["multiline_count"] += int("\n" in value)
            if len(stats["samples"]) < self.sample_limit and not isinstance(value, (dict, list)):
                if value not in stats["samples"]:
                    stats["samples"].append(value)
        if isinstance(value, dict):
            for key, child in value.items():
                self._walk(child, f"{path}.{key}" if path else key)
        elif isinstance(value, list):
            for child in value:
                self._walk(child, f"{path}[]")

    def result(self) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        for path, raw in self.stats.items():
            stats = dict(raw)
            stats["null_count"] = self.total - stats["count"] + stats["null_count"]
            strings = stats["string_count"]
            stats["multiline_ratio"] = stats.pop("multiline_count") / strings if strings else 0
            fields[path] = stats
        return {"record_count": self.total, "fields": fields}
