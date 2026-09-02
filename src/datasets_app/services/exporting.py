from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

from datasets_app.models import DatasetSplit


def iter_export(split: DatasetSplit) -> Iterator[bytes]:
    records = split.records.filter(is_deleted=False).order_by("position", "id").only("current_json")
    for record in records.iterator(chunk_size=1000):
        yield (json.dumps(record.current_json, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def export_to_path(split: DatasetSplit, destination: str, overwrite: bool = False) -> Path:
    target = Path(destination).expanduser().resolve()
    if target.suffix.lower() not in {".jsonl", ".ndjson"}:
        raise ValueError("Destination must use .jsonl or .ndjson")
    if target.exists() and not overwrite:
        raise FileExistsError("Destination exists; confirm overwrite explicitly")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            for chunk in iter_export(split):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, target)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise
    return target
