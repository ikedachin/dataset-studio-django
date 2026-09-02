import { useEffect, useState } from "react";
import type { JsonObject } from "../types";
import { PersistentTextarea } from "./PersistentTextarea";

export function RawJsonEditor({
  value,
  onApply,
}: {
  value: JsonObject;
  onApply: (value: JsonObject) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  const parse = (): JsonObject | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Record must be a JSON object");
      setError("");
      return parsed as JsonObject;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      return null;
    }
  };
  return (
    <div className="raw-editor">
      <PersistentTextarea
        storageKey="raw-json"
        aria-label="Raw JSON"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        rows={28}
      />
      {error && <p className="error-text">{error}</p>}
      <div className="button-row">
        <button
          className="secondary"
          onClick={() => {
            const parsed = parse();
            if (parsed) setText(JSON.stringify(parsed, null, 2));
          }}
        >
          Format
        </button>
        <button
          onClick={() => {
            const parsed = parse();
            if (parsed) onApply(parsed);
          }}
        >
          Apply JSON
        </button>
      </div>
    </div>
  );
}
