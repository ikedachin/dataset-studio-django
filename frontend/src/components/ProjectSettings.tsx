import { useState } from "react";
import { X } from "lucide-react";
import { api, jsonBody } from "../api/client";
import type { Project } from "../types";

const SYNC_RULE_EXAMPLE = JSON.stringify(
  [
    { source: "question", target: "messages[0].content" },
    {
      template: "<think>{{ thinking }}</think>\n{{ answer }}",
      target: "messages[1].content",
    },
  ],
  null,
  2,
);

export function ProjectSettings({
  project,
  onSaved,
  onClose,
}: {
  project: Project;
  onSaved: (project: Project) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [identifiers, setIdentifiers] = useState(
    project.identifierFields.join(", "),
  );
  const required = Array.isArray(project.validationSettings.required_fields)
    ? project.validationSettings.required_fields.join(", ")
    : "";
  const [requiredFields, setRequiredFields] = useState(required);
  const [rules, setRules] = useState(
    JSON.stringify(project.syncRules, null, 2),
  );
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<{
    total: number;
    valid: number;
    warnings: number;
    errors: number;
  }>();
  const save = async () => {
    try {
      const syncRules: unknown = JSON.parse(rules);
      if (!Array.isArray(syncRules))
        throw new Error("Sync rules must be a JSON array");
      const updated = await api<Project>(`/projects/${project.id}/`, {
        method: "PATCH",
        ...jsonBody({
          name,
          sync_rules: syncRules,
          identifier_fields: identifiers
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          validation_settings: {
            ...project.validationSettings,
            required_fields: requiredFields
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          },
        }),
      });
      onSaved(updated);
      setMessage("Settings saved");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save settings",
      );
    }
  };
  const validate = async () => {
    setMessage("Validating dataset…");
    const result = await api<{
      total: number;
      valid: number;
      warnings: number;
      errors: number;
    }>(`/projects/${project.id}/validate/`, { method: "POST" });
    setSummary(result);
    setMessage("Validation complete");
  };
  return (
    <div className="modal-backdrop">
      <section className="modal settings-modal">
        <header>
          <div>
            <small>PROJECT</small>
            <h2>Workspace settings</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="settings-form">
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Identifier fields
            <span>Comma-separated JSON paths used for duplicate checks.</span>
            <input
              value={identifiers}
              onChange={(e) => setIdentifiers(e.target.value)}
            />
          </label>
          <label>
            Required fields
            <span>
              Comma-separated JSON paths. Nothing is required automatically.
            </span>
            <input
              value={requiredFields}
              onChange={(e) => setRequiredFields(e.target.value)}
            />
          </label>
          <label>
            Manual sync rules
            <span>
              Rules run only after an explicit Sync action. Use source/target or
              template/target.
            </span>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={10}
            />
          </label>
          <details className="sync-rules-help">
            <summary>Manual sync rulesの書き方の例</summary>
            <div className="sync-rules-help-content">
              <p>
                <code>source</code>の値を<code>target</code>へコピーする例と、
                <code>template</code>で複数フィールドを組み立てる例です。
              </p>
              <pre>{SYNC_RULE_EXAMPLE}</pre>
              <ul>
                <li>
                  <code>source</code>: コピー元のJSON path
                </li>
                <li>
                  <code>target</code>: コピー先のJSON path
                </li>
                <li>
                  <code>{"{{ field.path }}"}</code>: 現在のRecordから値を参照
                </li>
              </ul>
              <p className="sync-rules-note">
                Syncは自動実行されません。Record画面のSyncからPreviewを確認し、明示的にApplyした場合だけ反映されます。
              </p>
            </div>
          </details>
          {summary && (
            <div className="validation-summary">
              <strong>{summary.total} total</strong>
              <span>{summary.valid} valid</span>
              <span>{summary.warnings} warnings</span>
              <span>{summary.errors} errors</span>
            </div>
          )}
          {message && <p className="muted">{message}</p>}
          <div className="button-row">
            <button className="secondary" onClick={() => void validate()}>
              Validate dataset
            </button>
            <button onClick={() => void save()}>Save settings</button>
          </div>
        </div>
      </section>
    </div>
  );
}
