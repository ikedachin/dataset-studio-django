from __future__ import annotations

import copy
import re
from typing import Any

from .json_tools import get_path, set_path

PLACEHOLDER = re.compile(r"{{\s*([A-Za-z0-9_.\[\]-]+)\s*}}")


def render_template(template: str, data: dict[str, Any]) -> str:
    return PLACEHOLDER.sub(lambda m: str(get_path(data, m.group(1), "")), template)


def preview_sync(data: dict[str, Any], rules: list[dict[str, str]]) -> dict[str, Any]:
    result = copy.deepcopy(data)
    changes: list[dict[str, Any]] = []
    for rule in rules:
        before = get_path(result, rule["target"])
        after = render_template(rule["template"], result) if "template" in rule else get_path(result, rule["source"])
        set_path(result, rule["target"], after)
        changes.append({"path": rule["target"], "before": before, "after": after})
    return {"data": result, "changes": changes}
