import { Cloud, FileUp, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { api, jsonBody } from "../api/client";
import type { Project } from "../types";

interface Job {
  id: number;
  status: string;
  current: number;
  total: number | null;
  percent: number | null;
  error: { message?: string };
}
export function ImportPanel({
  project,
  onClose,
  onComplete,
}: {
  project: Project;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [tab, setTab] = useState<"upload" | "local" | "huggingface">(
    project.sourceType,
  );
  const [path, setPath] = useState("");
  const [repository, setRepository] = useState("");
  const [split, setSplit] = useState("train");
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState("");
  const watch = async (id: number) => {
    const poll = async () => {
      const current = await api<Job>(`/jobs/${id}/`);
      setJob(current);
      if (current.status === "completed") {
        onComplete();
        return;
      }
      if (["failed", "interrupted"].includes(current.status)) {
        setError(current.error.message ?? "Import failed");
        return;
      }
      window.setTimeout(() => void poll(), 700);
    };
    await poll();
  };
  const submitUpload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("project_id", String(project.id));
    form.set("split_name", split);
    const created = await api<Job>("/import/upload/", {
      method: "POST",
      body: form,
    });
    setJob(created);
    await watch(created.id);
  };
  const submit = async () => {
    setError("");
    try {
      const endpoint =
        tab === "local" ? "/import/local/" : "/import/huggingface/";
      const body =
        tab === "local"
          ? { project_id: project.id, path, split_name: split }
          : { project_id: project.id, repository, split, split_name: split };
      const created = await api<Job>(endpoint, {
        method: "POST",
        ...jsonBody(body),
      });
      setJob(created);
      await watch(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header>
          <div>
            <small>ADD DATA</small>
            <h2>Import dataset</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="tabs import-tabs">
          <button
            className={tab === "upload" ? "active" : ""}
            onClick={() => setTab("upload")}
          >
            <FileUp /> Upload
          </button>
          <button
            className={tab === "local" ? "active" : ""}
            onClick={() => setTab("local")}
          >
            <FolderOpen /> Local path
          </button>
          <button
            className={tab === "huggingface" ? "active" : ""}
            onClick={() => setTab("huggingface")}
          >
            <Cloud /> Hugging Face
          </button>
        </div>
        {job ? (
          <div className="job-progress">
            <div className="spinner" />
            <h3>
              {job.status === "running" ? "Reading dataset…" : job.status}
            </h3>
            <strong>
              {job.current.toLocaleString()}{" "}
              {job.total ? `/ ${job.total.toLocaleString()}` : ""}
            </strong>
            <div className="progress">
              <i style={{ width: `${job.percent ?? 12}%` }} />
            </div>
          </div>
        ) : (
          <div className="import-form">
            <label>
              Split name
              <input value={split} onChange={(e) => setSplit(e.target.value)} />
            </label>
            {tab === "upload" && (
              <label className="dropzone">
                <FileUp />
                <strong>Drop a JSONL file here</strong>
                <span>or click to browse · .jsonl / .ndjson</span>
                <input
                  type="file"
                  accept=".jsonl,.ndjson"
                  onChange={(e) =>
                    e.target.files?.[0] && void submitUpload(e.target.files[0])
                  }
                />
              </label>
            )}
            {tab === "local" && (
              <label>
                Absolute file path
                <input
                  placeholder="/home/user/data/train.jsonl"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
              </label>
            )}
            {tab === "huggingface" && (
              <>
                <label>
                  Dataset repository
                  <input
                    placeholder="owner/dataset"
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                  />
                </label>
                <p className="muted">
                  HF_TOKEN is read from the server environment and is never
                  stored.
                </p>
              </>
            )}
            {tab !== "upload" && (
              <button onClick={() => void submit()}>Start import</button>
            )}
          </div>
        )}
        {error && <p className="error-box">{error}</p>}
      </section>
    </div>
  );
}
