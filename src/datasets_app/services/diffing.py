from __future__ import annotations

from typing import Any


def structural_diff(original: Any, current: Any, path: str = "$") -> list[dict[str, Any]]:
    if isinstance(original, dict) and isinstance(current, dict):
        changes: list[dict[str, Any]] = []
        for key in sorted(original.keys() | current.keys()):
            child = f"{path}.{key}"
            if key not in original:
                changes.append({"type": "added", "path": child, "after": current[key]})
            elif key not in current:
                changes.append({"type": "removed", "path": child, "before": original[key]})
            else:
                changes.extend(structural_diff(original[key], current[key], child))
        return changes
    if isinstance(original, list) and isinstance(current, list):
        changes = []
        for index in range(max(len(original), len(current))):
            child = f"{path}[{index}]"
            if index >= len(original):
                changes.append({"type": "added", "path": child, "after": current[index]})
            elif index >= len(current):
                changes.append({"type": "removed", "path": child, "before": original[index]})
            else:
                changes.extend(structural_diff(original[index], current[index], child))
        return changes
    if original != current:
        return [{"type": "modified", "path": path, "before": original, "after": current}]
    return []
