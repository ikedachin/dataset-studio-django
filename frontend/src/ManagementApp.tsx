import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
        error instanceof ApiError ? error.message : "Failed to execute operation",
      );
    },
  });
  if (resources.isLoading || logs.isLoading) {
    return <div className="center-state">Loading management view…</div>;
  }
  const projectCount = resources.data?.projects.length ?? 0;
  const deletedProjectCount = resources.data?.deletedProjects.length ?? 0;
  const splitCount =
    resources.data?.projects.reduce((count, project) => count + project.splits.length, 0) ??
    0;
  const deletedSplitCount = resources.data?.deletedSplits.length ?? 0;
  const protectedProjectCount =
    resources.data?.projects.filter((project) => project.isProtected).length ?? 0;
  const protectedSplitCount =
    resources.data?.projects.reduce(
      (count, project) =>
        count + project.splits.filter((split) => split.isEffectivelyProtected).length,
      0,
    ) ?? 0;
  return (
    <main className="management-page">
      <header>
        <div className="management-nav">
          <a className="button" href="/">
            Back to editor
          </a>
        </div>
        <h1>Dataset Guard Management</h1>
        <p>
          Confirm using exact text before protect/unprotect/logical delete/physical
          delete actions.
        </p>
        <div className="management-summary">
          <SummaryItem label="Active projects" value={projectCount} />
          <SummaryItem label="Deleted projects" value={deletedProjectCount} />
          <SummaryItem label="Active splits" value={splitCount} />
          <SummaryItem label="Deleted splits" value={deletedSplitCount} />
          <SummaryItem label="Protected projects" value={protectedProjectCount} />
          <SummaryItem label="Protected splits" value={protectedSplitCount} />
        </div>
        {message && <p className="muted">{message}</p>}
      </header>
      <div className="management-columns">
        <section>
          <h2>Active projects</h2>
          {resources.data?.projects.length ? (
            resources.data.projects.map((project) => (
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
            ))
          ) : (
            <p className="muted">No active projects.</p>
          )}
        </section>
        <section>
          <h2>Deleted projects</h2>
          {resources.data?.deletedProjects.length ? (
            resources.data.deletedProjects.map((project) => (
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
            ))
          ) : (
            <p className="muted">No deleted projects.</p>
          )}
        </section>
      </div>
      <section>
        <h2>Deleted splits (project still active)</h2>
        {resources.data?.deletedSplits.length ? (
          <div className="management-sublist">
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
          <p className="muted">No deleted splits.</p>
        )}
      </section>
      <section>
        <h2>Audit logs (latest 100)</h2>
        <ul className="management-logs">
          {logs.data?.map((log) => (
            <li key={log.id}>
              <strong>{log.action}</strong> {log.targetType}:{log.targetId}{" "}
              <span className={`result-${log.result}`}>{log.result}</span>{" "}
              <small>
                {log.actor} @ {new Date(log.executedAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
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
    <article className="management-card" data-testid={`project-card-${project.id}`}>
      <h3>
        {project.name} <small>({project.guardId})</small>
      </h3>
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
    <article className="management-card nested" data-testid={`split-card-${split.id}`}>
      <h4>
        Split: {split.name} <small>({split.projectName})</small>
      </h4>
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
        Confirm text: <code>{expected}</code>
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

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
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
