import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  FileDiff,
  FilePlus2,
  FileUp,
  FolderOpen,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, jsonBody } from "./api/client";
import { DynamicFieldEditor } from "./components/DynamicFieldEditor";
import { ExportPanel } from "./components/ExportPanel";
import { FieldFilter, FilterBuilder } from "./components/FilterBuilder";
import { ImportPanel } from "./components/ImportPanel";
import { ProjectSettings } from "./components/ProjectSettings";
import { RawJsonEditor } from "./components/RawJsonEditor";
import { RecordList } from "./components/RecordList";
import { useAutosave } from "./hooks/useAutosave";
import { useResizablePanes } from "./hooks/useResizablePanes";
import type {
  DiffItem,
  JsonObject,
  Project,
  RecordDetail,
  RecordPage,
  Split,
  ValidationIssue,
} from "./types";

export default function App() {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState<number>();
  const [splitId, setSplitId] = useState<number>();
  const [recordId, setRecordId] = useState<number>();
  const [search, setSearch] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState<FieldFilter[]>([]);
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [sideTab, setSideTab] = useState<
    "diff" | "validation" | "raw" | "metadata"
  >("diff");
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [data, setData] = useState<JsonObject>({});
  const { widths: paneWidths, startResize, nudge } = useResizablePanes();
  const searchRef = useRef<HTMLInputElement>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/projects/"),
  });
  const project =
    projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0];
  useEffect(() => {
    if (!projectId && project) setProjectId(project.id);
  }, [project, projectId]);
  const splits = useQuery({
    queryKey: ["splits", project?.id],
    queryFn: () => api<Split[]>(`/projects/${project!.id}/splits/`),
    enabled: !!project,
  });
  const split = splits.data?.find((s) => s.id === splitId) ?? splits.data?.[0];
  useEffect(() => {
    if (split && split.id !== splitId) {
      setSplitId(split.id);
      setRecordId(undefined);
    }
  }, [split, splitId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchValue), 300);
    return () => clearTimeout(timer);
  }, [searchValue]);
  const validFilters = filters.filter((filter) => filter.path.trim());
  const filterQuery = JSON.stringify(validFilters);
  const page = useQuery({
    queryKey: [
      "records",
      split?.id,
      search,
      status,
      filterQuery,
      sort,
      direction,
    ],
    queryFn: () =>
      api<RecordPage>(
        `/splits/${split!.id}/records/?limit=500&search=${encodeURIComponent(search)}&status=${status}&filters=${encodeURIComponent(filterQuery)}&sort=${encodeURIComponent(sort)}&direction=${direction}`,
      ),
    enabled: !!split,
  });
  useEffect(() => {
    if (!recordId && page.data?.items[0]) setRecordId(page.data.items[0].id);
  }, [page.data, recordId]);
  const record = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => api<RecordDetail>(`/records/${recordId}/`),
    enabled: !!recordId,
  });
  const loadedRecordId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (record.data && loadedRecordId.current !== record.data.id) {
      loadedRecordId.current = record.data.id;
      setData(structuredClone(record.data.data));
    }
  }, [record.data]);
  const saved = useCallback(
    (next: RecordDetail) => {
      client.setQueryData(["record", next.id], next);
      void client.invalidateQueries({ queryKey: ["records", split?.id] });
    },
    [client, split?.id],
  );
  const autosave = useAutosave(record.data, data, saved);
  const changeData = (next: JsonObject) => {
    setData(next);
    autosave.markDirty();
  };
  const diff = useQuery({
    queryKey: ["diff", recordId, record.data?.version],
    queryFn: () => api<DiffItem[]>(`/records/${recordId}/diff/`),
    enabled: !!recordId && sideTab === "diff" && autosave.state === "saved",
  });
  const validate = useMutation({
    mutationFn: () =>
      api<ValidationIssue[]>(`/records/${recordId}/validate/`, {
        method: "POST",
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["records", split?.id] }),
  });
  const navigate = useCallback(
    async (direction: number) => {
      await autosave.save();
      const items = page.data?.items ?? [];
      const index = items.findIndex((item) => item.id === recordId);
      const next = items[index + direction];
      if (next) setRecordId(next.id);
    },
    [autosave, page.data, recordId],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void autosave.save();
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        void navigate(1);
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        !mod &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      )
        void navigate(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [autosave, navigate]);
  const createProject = async (
    sourceType: "upload" | "local" | "huggingface",
  ) => {
    const name = window.prompt("Project name", "My Dataset");
    if (!name) return;
    const created = await api<Project>("/projects/", {
      method: "POST",
      ...jsonBody({ name, source_type: sourceType }),
    });
    await client.invalidateQueries({ queryKey: ["projects"] });
    setProjectId(created.id);
    setShowImport(true);
  };
  if (projects.isLoading)
    return (
      <div className="center-state">
        <div className="spinner" /> Loading Dataset Studio…
      </div>
    );
  if (!project) return <EmptyState onCreate={createProject} />;
  const mutateRecord = async (action: string, method = "POST") => {
    if (!recordId) return;
    await autosave.save();
    if (
      action === "revert" &&
      !window.confirm("Revert this record to its imported state?")
    )
      return;
    if (action === "delete" && !window.confirm("Mark this record as deleted?"))
      return;
    const result = await api<RecordDetail | { removed: boolean }>(
      `/records/${recordId}/${action === "delete" ? "" : `${action}/`}`,
      { method: action === "delete" ? "DELETE" : method },
    );
    await client.invalidateQueries({ queryKey: ["records", split?.id] });
    if ("removed" in result) setRecordId(undefined);
    else {
      client.setQueryData(["record", result.id], result);
      setData(result.data);
    }
  };
  const addRecord = async () => {
    if (!split) return;
    const next = await api<RecordDetail>(`/splits/${split.id}/records/`, {
      method: "POST",
      ...jsonBody({ data: {} }),
    });
    await client.invalidateQueries({ queryKey: ["records", split.id] });
    setRecordId(next.id);
  };
  const runSync = async () => {
    if (!record.data || !project.syncRules.length) return;
    await autosave.save();
    const current =
      client.getQueryData<RecordDetail>(["record", record.data.id]) ??
      record.data;
    const preview = await api<{
      changes: Array<{ path: string; before: unknown; after: unknown }>;
    }>(`/records/${current.id}/sync/`, {
      method: "POST",
      ...jsonBody({ version: current.version, apply: false }),
    });
    const summary = preview.changes
      .map(
        (change) =>
          `${change.path}\nBefore: ${JSON.stringify(change.before)}\nAfter: ${JSON.stringify(change.after)}`,
      )
      .join("\n\n");
    if (!window.confirm(`Apply these manual sync changes?\n\n${summary}`))
      return;
    const applied = await api<{ record: RecordDetail }>(
      `/records/${current.id}/sync/`,
      {
        method: "POST",
        ...jsonBody({ version: current.version, apply: true }),
      },
    );
    client.setQueryData(["record", applied.record.id], applied.record);
    setData(applied.record.data);
  };
  const currentIndex =
    (page.data?.items.findIndex((item) => item.id === recordId) ?? -1) + 1;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Braces />
          </span>
          <div>
            <strong>Dataset Studio</strong>
            <small>JSONL WORKSPACE</small>
          </div>
        </div>
        <select
          value={project.id}
          onChange={async (e) => {
            const nextProject = Number(e.target.value);
            await autosave.save();
            setProjectId(nextProject);
            setSplitId(undefined);
          }}
        >
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <nav className="split-tabs">
          {splits.data?.map((s) => (
            <button
              className={s.id === split?.id ? "active" : ""}
              key={s.id}
              onClick={async () => {
                await autosave.save();
                setSplitId(s.id);
                setRecordId(undefined);
              }}
            >
              {s.name}
              <span>{s.recordCount.toLocaleString()}</span>
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button onClick={() => setShowImport(true)}>
            <FileUp />
            Import
          </button>
          {split && <button onClick={() => setShowExport(true)}>Export</button>}
          <button aria-label="Settings" onClick={() => setShowSettings(true)}>
            <Settings />
          </button>
        </div>
      </header>
      <section className="toolbar">
        <div className="search-box">
          <Search />
          <input
            ref={searchRef}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search all fields…"
          />
          <kbd>⌘ F</kbd>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All records</option>
          <option value="unedited">Unedited</option>
          <option value="edited">Edited</option>
          <option value="new">New</option>
          <option value="deleted">Deleted</option>
          <option value="validation_error">Validation error</option>
        </select>
        <div className="filter-wrap">
          <button
            className={validFilters.length ? "filter-active" : ""}
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal /> Filters {validFilters.length || ""}
          </button>
          {showFilters && (
            <FilterBuilder
              filters={filters}
              onChange={setFilters}
              sort={sort}
              direction={direction}
              onSort={(field, nextDirection) => {
                setSort(field);
                setDirection(nextDirection);
              }}
              onClose={() => setShowFilters(false)}
            />
          )}
        </div>
        <button className="secondary" onClick={() => void addRecord()}>
          <FilePlus2 /> Add record
        </button>
      </section>
      <main
        className="workspace"
        style={
          {
            "--list-pane-width": `${paneWidths.left}px`,
            "--details-pane-width": `${paneWidths.right}px`,
          } as React.CSSProperties
        }
      >
        <aside className="list-pane">
          <div className="pane-title">
            <span>RECORDS</span>
            <strong>{page.data?.total.toLocaleString() ?? 0}</strong>
          </div>
          <RecordList
            records={page.data?.items ?? []}
            selected={recordId}
            onSelect={async (id) => {
              await autosave.save();
              setRecordId(id);
            }}
          />
        </aside>
        <div
          className="pane-resizer left-resizer"
          role="separator"
          aria-label="Resize record list"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResize("left", event.clientX)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              nudge("left", event.key === "ArrowLeft" ? -20 : 20);
            }
          }}
        />
        <section className="editor-pane">
          {record.data ? (
            <>
              <div className="editor-head">
                <div>
                  <small>RECORD {record.data.position.toLocaleString()}</small>
                  <h1>{record.data.preview || "Untitled record"}</h1>
                </div>
                <div className="record-actions">
                  <button
                    title="Duplicate"
                    onClick={() => void mutateRecord("duplicate")}
                  >
                    <Copy />
                  </button>
                  {record.data.isDeleted ? (
                    <button
                      title="Restore"
                      onClick={() => void mutateRecord("restore")}
                    >
                      <RotateCcw />
                    </button>
                  ) : (
                    <button
                      title="Delete"
                      onClick={() => void mutateRecord("delete")}
                    >
                      <Trash2 />
                    </button>
                  )}
                  <button
                    title="Revert"
                    onClick={() => void mutateRecord("revert")}
                  >
                    <RotateCcw />
                  </button>
                  {project.syncRules.length > 0 && (
                    <button
                      title="Preview manual sync"
                      onClick={() => void runSync()}
                    >
                      Sync
                    </button>
                  )}
                  <button
                    className="save-button"
                    onClick={() => void autosave.save()}
                  >
                    <Save />
                    {autosave.state}
                  </button>
                </div>
              </div>
              <div className="editor-scroll">
                <DynamicFieldEditor
                  value={data}
                  layoutKey={project.id.toString()}
                  onChange={(value) => changeData(value as JsonObject)}
                />
              </div>
              <div className="navigation">
                <button
                  onClick={() => void navigate(-1)}
                  disabled={currentIndex <= 1}
                >
                  <ChevronLeft />
                  Previous
                </button>
                <span>
                  <strong>{currentIndex}</strong> /{" "}
                  {page.data?.total.toLocaleString()}
                </span>
                <button
                  onClick={() => void navigate(1)}
                  disabled={currentIndex >= (page.data?.items.length ?? 0)}
                >
                  Next
                  <ChevronRight />
                </button>
              </div>
            </>
          ) : (
            <div className="center-state">
              Select a record to begin editing.
            </div>
          )}
        </section>
        <div
          className="pane-resizer right-resizer"
          role="separator"
          aria-label="Resize details panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResize("right", event.clientX)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              nudge("right", event.key === "ArrowLeft" ? -20 : 20);
            }
          }}
        />
        <aside className="details-pane">
          <div className="tabs">
            <button
              className={sideTab === "diff" ? "active" : ""}
              onClick={() => setSideTab("diff")}
            >
              <FileDiff />
              Diff
            </button>
            <button
              className={sideTab === "validation" ? "active" : ""}
              onClick={() => {
                setSideTab("validation");
                validate.mutate();
              }}
            >
              <CheckCircle2 />
              Validate
            </button>
            <button
              className={sideTab === "raw" ? "active" : ""}
              onClick={() => setSideTab("raw")}
            >
              <Braces />
              Raw
            </button>
          </div>
          <div className="details-scroll">
            {sideTab === "diff" && <DiffPanel items={diff.data ?? []} />}{" "}
            {sideTab === "validation" && (
              <ValidationPanel issues={validate.data ?? []} />
            )}{" "}
            {sideTab === "raw" && record.data && (
              <RawJsonEditor value={data} onApply={changeData} />
            )}
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span className="accent">{split?.name ?? "no split"}</span>
        <span>{page.data?.total.toLocaleString() ?? 0} records</span>
        <span>Record {currentIndex || "—"}</span>
        <span className={record.data?.status === "edited" ? "edited" : ""}>
          {record.data?.status ?? "No record"}
        </span>
        <span className="status-save">
          {autosave.state === "saved" ? (
            <CheckCircle2 />
          ) : (
            <span className="spinner small" />
          )}
          {autosave.state}
        </span>
        <span>UTF-8 · JSONL</span>
      </footer>
      {showImport && (
        <ImportPanel
          project={project}
          onClose={() => setShowImport(false)}
          onComplete={() => {
            void client.invalidateQueries({ queryKey: ["splits", project.id] });
            setShowImport(false);
          }}
        />
      )}
      {showExport && split && (
        <ExportPanel split={split} onClose={() => setShowExport(false)} />
      )}
      {showSettings && (
        <ProjectSettings
          project={project}
          onClose={() => setShowSettings(false)}
          onSaved={(updated) => {
            client.setQueryData<Project[]>(["projects"], (current = []) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  onCreate,
}: {
  onCreate: (type: "upload" | "local" | "huggingface") => void;
}) {
  return (
    <main className="empty-page">
      <div className="brand large">
        <span className="brand-mark">
          <Braces />
        </span>
        <div>
          <strong>Dataset Studio</strong>
          <small>LOCAL-FIRST JSONL EDITOR</small>
        </div>
      </div>
      <section>
        <small>START A WORKSPACE</small>
        <h1>Create Dataset Project</h1>
        <p>
          Inspect, edit, validate, and export arbitrary JSONL data without
          changing your source file.
        </p>
        <div className="source-grid">
          <button onClick={() => void onCreate("upload")}>
            <FileUp />
            <strong>Upload JSONL</strong>
            <span>Drop a .jsonl or .ndjson file</span>
          </button>
          <button onClick={() => void onCreate("local")}>
            <FolderOpen />
            <strong>Open Local JSONL</strong>
            <span>Read a path on this computer</span>
          </button>
          <button onClick={() => void onCreate("huggingface")}>
            <Cloud />
            <strong>Hugging Face</strong>
            <span>Stream a dataset repository</span>
          </button>
        </div>
      </section>
      <footer>Your source data is never overwritten.</footer>
    </main>
  );
}
export function DiffPanel({ items }: { items: DiffItem[] }) {
  if (!items.length)
    return (
      <div className="panel-empty">
        <CheckCircle2 />
        <h3>No changes</h3>
        <p>This record matches the imported original.</p>
      </div>
    );
  return (
    <div className="diff-list">
      {items.map((item, i) => (
        <article key={`${item.path}-${i}`} className={item.type}>
          <header>
            <span>{item.type}</span>
            <code>{item.path}</code>
          </header>
          {item.before !== undefined && (
            <pre>- {JSON.stringify(item.before, null, 2)}</pre>
          )}
          {item.after !== undefined && (
            <pre>+ {JSON.stringify(item.after, null, 2)}</pre>
          )}
        </article>
      ))}
    </div>
  );
}
export function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length)
    return (
      <div className="panel-empty">
        <CheckCircle2 />
        <h3>Validation OK</h3>
        <p>No issues found in this record.</p>
      </div>
    );
  return (
    <div className="issue-list">
      {issues.map((issue, i) => (
        <article key={i} className={issue.severity}>
          <strong>{issue.code}</strong>
          <code>{issue.path}</code>
          <p>{issue.message}</p>
        </article>
      ))}
    </div>
  );
}
