import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Database,
  FolderOpen,
  History,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { ApiError, api, jsonBody } from "./api/client";
import type {
  GuardAuditLog,
  ManagedProject,
  ManagedSplit,
  ManagementResources,
} from "./types";

type GuardAction = "protect" | "unprotect" | "soft_delete" | "hard_delete";

const ACTION_LABELS: Record<GuardAction, string> = {
  protect: "Protect",
  unprotect: "Unprotect",
  soft_delete: "Logical delete",
  hard_delete: "Physical delete",
};

export default function ManagementApp() {
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const resources = useQuery({
    queryKey: ["management-resources"],
    queryFn: () => api<ManagementResources>("/management/resources/"),
  });
  const logs = useQuery({
    queryKey: ["management-audit-logs"],
    queryFn: () => api<GuardAuditLog[]>("/management/audit-logs/"),
  });
  const mutation = useMutation({
    mutationFn: ({
      kind,
      id,
      action,
      confirmationText,
    }: {
      kind: "projects" | "splits";
      id: number;
      action: GuardAction;
      confirmationText: string;
    }) =>
      api(`/management/${kind}/${id}/actions/`, {
        method: "POST",
        ...jsonBody({ action, confirmation_text: confirmationText }),
      }),
    onSuccess: async () => {
      setMessage("Operation completed");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["management-resources"] }),
        client.invalidateQueries({ queryKey: ["management-audit-logs"] }),
      ]);
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Failed to execute operation",
      );
    },
  });
  if (resources.isLoading || logs.isLoading) {
    return <div className="center-state">Loading management view…</div>;
  }
  const projectCount = resources.data?.projects.length ?? 0;
  const deletedProjectCount = resources.data?.deletedProjects.length ?? 0;
  const splitCount =
    resources.data?.projects.reduce(
      (count, project) => count + project.splits.length,
      0,
    ) ?? 0;
  const deletedSplitCount = resources.data?.deletedSplits.length ?? 0;
  const protectedProjectCount =
    resources.data?.projects.filter((project) => project.isProtected).length ??
    0;
  const protectedSplitCount =
    resources.data?.projects.reduce(
      (count, project) =>
        count +
        project.splits.filter((split) => split.isEffectivelyProtected).length,
      0,
    ) ?? 0;
  return (
    <main className="management-page">
      <header className="management-header">
        <div className="management-topbar">
          <a className="management-back" href="/">
            <ArrowLeft aria-hidden="true" />
            Back to editor
          </a>
          <span className="management-context">
            <ShieldCheck aria-hidden="true" />
            Dataset Guard
          </span>
        </div>
        <div className="management-intro">
          <p className="management-eyebrow">RESOURCE CONTROL</p>
          <h1>Management</h1>
          <p className="management-description">
            Review protection and deletion status for every project and split.
            Destructive actions unlock only after the exact confirmation text is
            entered.
          </p>
        </div>
        <div className="management-summary">
          <SummaryItem
            label="Active projects"
            value={projectCount}
            tone="active"
          />
          <SummaryItem label="Active splits" value={splitCount} tone="active" />
          <SummaryItem
            label="Protected resources"
            value={protectedProjectCount + protectedSplitCount}
            detail={`${protectedProjectCount} projects · ${protectedSplitCount} splits`}
            tone="protected"
          />
          <SummaryItem
            label="Deleted resources"
            value={deletedProjectCount + deletedSplitCount}
            detail={`${deletedProjectCount} projects · ${deletedSplitCount} splits`}
            tone="deleted"
          />
        </div>
        {message && (
          <p className="management-message" role="status">
            {message}
          </p>
        )}
      </header>
      <div className="management-resource-layout">
        <section className="management-section management-primary-section">
          <div className="management-section-heading">
            <div>
              <span className="management-section-icon">
                <FolderOpen aria-hidden="true" />
              </span>
              <div>
                <h2>Active projects</h2>
                <p>Manage project-level and inherited split protection.</p>
              </div>
            </div>
            <span className="management-count">{projectCount}</span>
          </div>
          {resources.data?.projects.length ? (
            <div className="management-card-list">
              {resources.data.projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onProjectAction={(action, confirmationText) =>
                    mutation.mutate({
                      kind: "projects",
                      id: project.id,
                      action,
                      confirmationText,
                    })
                  }
                  onSplitAction={(splitId, action, confirmationText) =>
                    mutation.mutate({
                      kind: "splits",
                      id: splitId,
                      action,
                      confirmationText,
                    })
                  }
                  disabled={mutation.isPending}
                />
              ))}
            </div>
          ) : (
            <EmptyState>No active projects.</EmptyState>
          )}
        </section>
        <aside className="management-recovery-column">
          <section className="management-section">
            <div className="management-section-heading compact">
              <div>
                <span className="management-section-icon danger">
                  <Trash2 aria-hidden="true" />
                </span>
                <div>
                  <h2>Deleted projects</h2>
                  <p>Resources awaiting permanent deletion.</p>
                </div>
              </div>
              <span className="management-count">{deletedProjectCount}</span>
            </div>
            {resources.data?.deletedProjects.length ? (
              <div className="management-card-list">
                {resources.data.deletedProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onProjectAction={(action, confirmationText) =>
                      mutation.mutate({
                        kind: "projects",
                        id: project.id,
                        action,
                        confirmationText,
                      })
                    }
                    onSplitAction={(splitId, action, confirmationText) =>
                      mutation.mutate({
                        kind: "splits",
                        id: splitId,
                        action,
                        confirmationText,
                      })
                    }
                    disabled={mutation.isPending}
                    deleted
                  />
                ))}
              </div>
            ) : (
              <EmptyState>No deleted projects.</EmptyState>
            )}
          </section>
          <section className="management-section">
            <div className="management-section-heading compact">
              <div>
                <span className="management-section-icon danger">
                  <Database aria-hidden="true" />
                </span>
                <div>
                  <h2>Deleted splits</h2>
                  <p>Deleted splits whose project is still active.</p>
                </div>
              </div>
              <span className="management-count">{deletedSplitCount}</span>
            </div>
            {resources.data?.deletedSplits.length ? (
              <div className="management-card-list">
                {resources.data.deletedSplits.map((split) => (
                  <SplitCard
                    key={split.id}
                    split={split}
                    onAction={(splitId, action, confirmationText) =>
                      mutation.mutate({
                        kind: "splits",
                        id: splitId,
                        action,
                        confirmationText,
                      })
                    }
                    disabled={mutation.isPending}
                    deleted
                  />
                ))}
              </div>
            ) : (
              <EmptyState>No deleted splits.</EmptyState>
            )}
          </section>
        </aside>
      </div>
      <section className="management-section management-audit-section">
        <div className="management-section-heading">
          <div>
            <span className="management-section-icon">
              <History aria-hidden="true" />
            </span>
            <div>
              <h2>Audit logs</h2>
              <p>The latest 100 resource operations.</p>
            </div>
          </div>
          <span className="management-count">{logs.data?.length ?? 0}</span>
        </div>
        <ul className="management-logs">
          {logs.data?.map((log) => (
            <li key={log.id}>
              <span className={`audit-result result-${log.result}`}>
                {log.result}
              </span>
              <div className="audit-operation">
                <strong>{log.action.replace("_", " ")}</strong>
                <code>
                  {log.targetType}:{log.targetId}
                </code>
              </div>
              <div className="audit-meta">
                <span>{log.actor}</span>
                <time dateTime={log.executedAt}>
                  {new Date(log.executedAt).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ul>
        {!logs.data?.length && <EmptyState>No audit activity yet.</EmptyState>}
      </section>
    </main>
  );
}

function ProjectCard({
  project,
  onProjectAction,
  onSplitAction,
  disabled,
  deleted = false,
}: {
  project: ManagedProject;
  onProjectAction: (action: GuardAction, confirmationText: string) => void;
  onSplitAction: (
    splitId: number,
    action: GuardAction,
    confirmationText: string,
  ) => void;
  disabled: boolean;
  deleted?: boolean;
}) {
  return (
    <article
      className="management-card"
      data-testid={`project-card-${project.id}`}
    >
      <div className="management-card-header">
        <div>
          <span className="resource-kind">PROJECT</span>
          <h3>{project.name}</h3>
          <code>{project.guardId}</code>
        </div>
        <div className="status-row">
          <StatusPill
            label={project.isProtected ? "protected" : "unprotected"}
            tone={project.isProtected ? "warning" : "success"}
          />
          <StatusPill
            label={project.deletedAt ? "logically deleted" : "active"}
            tone={project.deletedAt ? "danger" : "success"}
          />
        </div>
      </div>
      <ConfirmationActions
        expected={project.guardId}
        disabled={disabled}
        actions={
          deleted
            ? ["hard_delete", "unprotect"]
            : ["protect", "unprotect", "soft_delete", "hard_delete"]
        }
        onAction={onProjectAction}
      />
      {project.splits.length > 0 && (
        <div className="management-sublist">
          {project.splits.map((split) => (
            <SplitCard
              key={split.id}
              split={split}
              onAction={onSplitAction}
              disabled={disabled}
              deleted={!!split.deletedAt}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function SplitCard({
  split,
  onAction,
  disabled,
  deleted = false,
}: {
  split: ManagedSplit;
  onAction: (
    splitId: number,
    action: GuardAction,
    confirmationText: string,
  ) => void;
  disabled: boolean;
  deleted?: boolean;
}) {
  return (
    <article
      className="management-card nested"
      data-testid={`split-card-${split.id}`}
    >
      <div className="management-card-header split-header">
        <div>
          <span className="resource-kind">SPLIT</span>
          <h4>{split.name}</h4>
          <span className="resource-parent">Project: {split.projectName}</span>
        </div>
        <div className="status-row">
          <StatusPill
            label={split.isEffectivelyProtected ? "protected" : "unprotected"}
            tone={split.isEffectivelyProtected ? "warning" : "success"}
          />
          {split.isInheritedProtected && (
            <StatusPill label="inherited protection" tone="neutral" />
          )}
          <StatusPill
            label={split.deletedAt ? "logically deleted" : "active"}
            tone={split.deletedAt ? "danger" : "success"}
          />
        </div>
      </div>
      <ConfirmationActions
        expected={split.name}
        disabled={disabled}
        actions={
          deleted
            ? ["hard_delete", "unprotect"]
            : ["protect", "unprotect", "soft_delete", "hard_delete"]
        }
        onAction={(action, confirmationText) =>
          onAction(split.id, action, confirmationText)
        }
      />
    </article>
  );
}

function ConfirmationActions({
  expected,
  actions,
  disabled,
  onAction,
}: {
  expected: string;
  actions: GuardAction[];
  disabled: boolean;
  onAction: (action: GuardAction, confirmationText: string) => void;
}) {
  const [value, setValue] = useState("");
  const valid = value === expected;
  return (
    <div className="confirmation-actions">
      <label>
        <span>Confirmation text</span>
        <code>{expected}</code>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Type exact confirmation text"
        />
      </label>
      <div className="button-row">
        {actions.map((action) => (
          <button
            key={action}
            className={`management-action action-${action}`}
            disabled={disabled || !valid}
            onClick={() => onAction(action, value)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail?: string;
  tone: "active" | "protected" | "deleted";
}) {
  return (
    <div className={`summary-item ${tone}`}>
      <span className="summary-label">{label}</span>
      <strong>{value.toLocaleString()}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="management-empty">{children}</p>;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}
