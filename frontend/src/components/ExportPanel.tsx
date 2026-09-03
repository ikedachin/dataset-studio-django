import { Download, X } from "lucide-react";
import { useState } from "react";
import { api, jsonBody } from "../api/client";
import type { Split } from "../types";

export function ExportPanel({
  split,
  onClose,
}: {
  split: Split;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    try {
      const result = await api<{ path: string }>("/export/path/", {
        method: "POST",
        ...jsonBody({ split_id: split.id, path, overwrite }),
      });
      setMessage(`Saved to ${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal export-modal">
        <header>
          <div>
            <small>EXPORT · {split.datasetName} / {split.name}</small>
            <h2>Export edited JSONL</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="settings-form">
          <p className="muted">
            Deleted records are excluded. New records are included in position
            order. Your source file is not changed.
          </p>
          <a
            className="button download-button"
            href={`/api/export/download/?split_id=${split.id}`}
          >
            <Download />
            Download {split.name}_edited.jsonl
          </a>
          <div className="divider">
            <span>OR SAVE ON THIS COMPUTER</span>
          </div>
          <label>
            Absolute destination path
            <input
              placeholder="/home/user/data/train_edited.jsonl"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Confirm overwrite if the destination exists
          </label>
          {message && <p className="muted">{message}</p>}
          <button disabled={!path} onClick={() => void save()}>
            Save atomically
          </button>
        </div>
      </section>
    </div>
  );
}
