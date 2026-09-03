import { Cloud, FileUp, FolderOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, jsonBody } from "../api/client";
import type { Project } from "../types";

interface Job {
  id: number;
  split: string;
  datasetName: string;
  status: string;
  current: number;
  total: number | null;
  percent: number | null;
  error: { message?: string };
}
interface DatasetInfo {
  configurations: string[];
  configuration: string | null;
  splits: string[];
}
const active = (job: Job) => ["pending", "running"].includes(job.status);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Import failed";

export function ImportPanel({
  project,
  onClose,
  onComplete,
}: {
  project: Project;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [tab, setTab] = useState(project.sourceType);
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState<string | null>(null);
  const [repository, setRepository] = useState("");
  const [revision, setRevision] = useState("");
  const [token, setToken] = useState("");
  const [split, setSplit] = useState("train");
  const [info, setInfo] = useState<DatasetInfo>();
  const [selected, setSelected] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showForm, setShowForm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pollPaused, setPollPaused] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const completedNotified = useRef(false);
  const retryTargets = useRef<string[] | null>(null);
  const running = jobs.some(active);
  const defaultDatasetName =
    tab === "huggingface"
      ? `${repository.trim()}${info?.configuration && info.configuration !== "default" ? `/${info.configuration}` : ""}`
      : ((tab === "upload" ? (file?.name ?? "") : path)
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? "");
  const targetDatasetName = (datasetName ?? defaultDatasetName).trim();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      requestController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!jobs.length || pollPaused) return;
    if (!jobs.some(active)) {
      if (
        jobs.every((job) => job.status === "completed") &&
        !completedNotified.current
      ) {
        completedNotified.current = true;
        onComplete();
      }
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all(
        jobs.map((job) =>
          active(job)
            ? api<Job>(`/jobs/${job.id}/`, { signal: controller.signal }).then(
                (current) => ({ ...current, split: job.split }),
              )
            : Promise.resolve(job),
        ),
      )
        .then((current) => {
          if (!controller.signal.aborted) setJobs(current);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(
              `Could not refresh progress: ${message(e)}. The import may still be running.`,
            );
            setPollPaused(true);
          }
        });
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [jobs, pollPaused, onComplete]);

  const invalidateInfo = () => {
    requestVersion.current += 1;
    requestController.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setInfo(undefined);
    setSelected([]);
    setError("");
  };
  const lookup = async (configuration?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSelected([]);
    setInfo(
      configuration && info
        ? { ...info, configuration, splits: [] }
        : undefined,
    );
    const version = ++requestVersion.current;
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const result = await api<DatasetInfo>("/huggingface/info/", {
        method: "POST",
        signal: controller.signal,
        ...jsonBody({
          repository,
          revision: revision || null,
          configuration: configuration || null,
          hf_token: token || null,
        }),
      });
      if (!mounted.current || version !== requestVersion.current) return;
      setInfo(result);
      const available = result.splits.filter(
        (name) =>
          !jobs.some((job) => job.split === name && job.status === "completed"),
      );
      setSelected(
        available.filter(
          (name) =>
            !retryTargets.current || retryTargets.current.includes(name),
        ),
      );
    } catch (e) {
      if (mounted.current && version === requestVersion.current) {
        setInfo(undefined);
        setError(message(e));
      }
    } finally {
      if (mounted.current && version === requestVersion.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const submit = async () => {
    if (busyRef.current || running || !targetDatasetName) return;
    setSubmitting(true);
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let created: Job[];
      if (tab === "upload") {
        if (!file) return;
        const form = new FormData();
        form.set("file", file);
        form.set("project_id", String(project.id));
        form.set("split_name", split);
        form.set("dataset_name", targetDatasetName);
        const job = await api<Job>("/import/upload/", {
          method: "POST",
          body: form,
        });
        created = [{ ...job, split, datasetName: targetDatasetName }];
      } else if (tab === "local") {
        const job = await api<Job>("/import/local/", {
          method: "POST",
          ...jsonBody({
            project_id: project.id,
            path,
            split_name: split,
            dataset_name: targetDatasetName,
          }),
        });
        created = [{ ...job, split, datasetName: targetDatasetName }];
      } else {
        const result = await api<{ jobs: Job[] }>(
          "/import/huggingface/batch/",
          {
            method: "POST",
            ...jsonBody({
              project_id: project.id,
              dataset_name: targetDatasetName,
              repository,
              revision: revision || null,
              configuration: info?.configuration,
              splits: selected,
              hf_token: token || null,
            }),
          },
        );
        created = result.jobs;
      }
      if (!mounted.current) return;
      setDatasetName(targetDatasetName);
      setToken("");
      setInfo(undefined);
      setSelected([]);
      setJobs((previous) => [
        ...previous.filter((job) => job.status === "completed"),
        ...created,
      ]);
      setShowForm(false);
      setPollPaused(false);
      completedNotified.current = false;
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        setSubmitting(false);
      }
    }
  };

  const retry = () => {
    retryTargets.current = jobs
      .filter((job) => job.status !== "completed")
      .map((job) => job.split);
    invalidateInfo();
    setShowForm(true);
  };

  return (
    <div className="modal-backdrop">
      <section className="modal import-modal">
        <header>
          <div>
            <small>ADD DATA</small>
            <h2>Import dataset</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close import"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="tabs import-tabs">
          <button
            disabled={busy || jobs.length > 0}
            className={tab === "upload" ? "active" : ""}
            onClick={() => {
              invalidateInfo();
              setTab("upload");
              setDatasetName(null);
            }}
          >
            <FileUp /> Upload
          </button>
          <button
            disabled={busy || jobs.length > 0}
            className={tab === "local" ? "active" : ""}
            onClick={() => {
              invalidateInfo();
              setTab("local");
              setDatasetName(null);
            }}
          >
            <FolderOpen /> Local path
          </button>
          <button
            disabled={busy || jobs.length > 0}
            className={tab === "huggingface" ? "active" : ""}
            onClick={() => {
              invalidateInfo();
              setTab("huggingface");
              setDatasetName(null);
            }}
          >
            <Cloud /> Hugging Face
          </button>
        </div>
        {jobs.length > 0 && (
          <div className="import-jobs" aria-live="polite">
            {jobs.map((job) => (
              <article key={job.id} className="import-job">
                <strong>
                  {job.datasetName} / {job.split}
                </strong>
                <span>{job.status}</span>
                <span>
                  {job.current.toLocaleString()}
                  {job.total !== null
                    ? ` / ${job.total.toLocaleString()}`
                    : ""}{" "}
                  records
                </span>
                {active(job) && (
                  <div className="progress">
                    <i style={{ width: `${job.percent ?? 12}%` }} />
                  </div>
                )}
                {job.error.message && (
                  <p className="error-box">{job.error.message}</p>
                )}
              </article>
            ))}
            {running && (
              <p className="muted">
                Closing this window keeps the import running.
              </p>
            )}
            {pollPaused && (
              <button
                onClick={() => {
                  setPollPaused(false);
                  setError("");
                }}
              >
                Resume progress updates
              </button>
            )}
            {!running &&
              !showForm &&
              jobs.some((job) => job.status !== "completed") && (
                <button onClick={retry}>Retry failed splits</button>
              )}
          </div>
        )}
        {showForm && (
          <div className="import-form">
            <label>
              Dataset name
              <input
                disabled={submitting || jobs.length > 0}
                maxLength={255}
                value={datasetName ?? defaultDatasetName}
                placeholder="Defaults to the repository or file name"
                onChange={(e) => setDatasetName(e.target.value)}
              />
            </label>
            <p className="muted">
              Different datasets can each contain a train split. Use the same
              dataset name to add another split to that dataset.
            </p>
            {tab !== "huggingface" && (
              <label>
                Split name
                <input
                  disabled={busy}
                  value={split}
                  onChange={(e) => setSplit(e.target.value)}
                />
              </label>
            )}
            {tab === "upload" && (
              <label className="dropzone">
                <FileUp />
                <strong>Choose a JSONL file</strong>
                <span>.jsonl / .ndjson</span>
                {file && <span>{file.name}</span>}
                <input
                  type="file"
                  aria-label="JSONL file"
                  disabled={busy}
                  accept=".jsonl,.ndjson"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                  }}
                />
              </label>
            )}
            {tab === "local" && (
              <label>
                Absolute file path
                <input
                  disabled={busy}
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
                    disabled={submitting}
                    placeholder="owner/dataset"
                    value={repository}
                    onChange={(e) => {
                      setRepository(e.target.value);
                      invalidateInfo();
                    }}
                  />
                </label>
                <label>
                  Revision (optional)
                  <input
                    disabled={submitting}
                    value={revision}
                    onChange={(e) => {
                      setRevision(e.target.value);
                      invalidateInfo();
                    }}
                    placeholder="branch, tag, or commit"
                  />
                </label>
                <label>
                  HF_TOKEN (optional)
                  <input
                    disabled={submitting}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      invalidateInfo();
                    }}
                  />
                </label>
                <p className="muted">
                  Used only for this import and never saved. Leave blank to use
                  server credentials or access a public dataset.
                </p>
                <button
                  disabled={busy || !repository.trim()}
                  onClick={() => void lookup()}
                >
                  {busy ? "Please wait…" : "Load dataset information"}
                </button>
                {info && (
                  <>
                    <label>
                      Configuration
                      <select
                        disabled={busy}
                        value={info.configuration ?? ""}
                        onChange={(e) => void lookup(e.target.value)}
                      >
                        <option value="" disabled>
                          Choose a Configuration
                        </option>
                        {info.configurations.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {info.configuration && (
                      <fieldset className="import-splits" disabled={busy}>
                        <legend>Splits</legend>
                        {info.splits.length === 0 && (
                          <p className="muted">No available splits.</p>
                        )}
                        {info.splits.map((name) => {
                          const unavailable =
                            jobs.some(
                              (job) =>
                                job.split === name &&
                                job.status === "completed",
                            ) ||
                            (retryTargets.current !== null &&
                              !retryTargets.current.includes(name));
                          return (
                            <label className="check-row" key={name}>
                              <input
                                type="checkbox"
                                disabled={unavailable}
                                checked={selected.includes(name)}
                                onChange={(e) =>
                                  setSelected((previous) =>
                                    e.target.checked
                                      ? [...previous, name]
                                      : previous.filter(
                                          (value) => value !== name,
                                        ),
                                  )
                                }
                              />
                              {name}
                              {unavailable && " (not part of this retry)"}
                            </label>
                          );
                        })}
                      </fieldset>
                    )}
                  </>
                )}
              </>
            )}
            {
              <button
                disabled={
                  busy ||
                  !targetDatasetName ||
                  targetDatasetName.length > 255 ||
                  (tab === "huggingface"
                    ? !info?.configuration || !selected.length
                    : !split.trim() ||
                      (tab === "upload" ? !file : !path.trim()))
                }
                onClick={() => void submit()}
              >
                Start import
              </button>
            }
          </div>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
