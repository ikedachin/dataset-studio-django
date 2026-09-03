import { ChevronDown, ChevronRight, Lock, Plus, Trash2, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { JsonObject, JsonValue } from "../types";
import { MessageEditor, isMessages } from "./MessageEditor";
import { PersistentTextarea } from "./PersistentTextarea";

const kindOf = (value: JsonValue): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const defaultValue = (kind: string): JsonValue =>
  ({
    string: "",
    number: 0,
    boolean: false,
    null: null,
    object: {},
    array: [],
  })[kind] as JsonValue;

export function DynamicFieldEditor({
  label,
  value,
  onChange,
  onDelete,
  path = "",
  layoutKey,
}: {
  label?: string;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  onDelete?: () => void;
  path?: string;
  layoutKey?: string;
}) {
  const kind = kindOf(value);
  const [open, setOpen] = useState(true);
  const header = label !== undefined && (
    <div className="field-label">
      <span>{label}</span>
      <span className="type-badge">{kind}</span>
      {onDelete && (
        <button
          className="icon-button danger"
          aria-label={`Delete ${label}`}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
  if (typeof value === "string") {
    return (
      <div className="field">
        {header}
        <PersistentTextarea
          storageKey={path || label || "record"}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  if (typeof value === "number")
    return (
      <div className="field">
        {header}
        <input
          type="number"
          value={value}
          step={Number.isInteger(value) ? 1 : "any"}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  if (typeof value === "boolean")
    return (
      <div className="field boolean-field">
        {header}
        <label className="switch">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span />
        </label>
      </div>
    );
  if (value === null)
    return (
      <div className="field">
        {header}
        <select
          aria-label={`${label} type`}
          value="null"
          onChange={(e) => onChange(defaultValue(e.target.value))}
        >
          <option value="null">null</option>
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="object">object</option>
          <option value="array">array</option>
        </select>
      </div>
    );
  if (Array.isArray(value)) {
    if (isMessages(value))
      return (
        <div className="field">
          {header}
          <MessageEditor
            value={value}
            path={path || label || "messages"}
            onChange={onChange}
          />
        </div>
      );
    return (
      <div className="field group-field">
        {header}
        <button className="collapse" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronRight />}
          {value.length} items
        </button>
        {open && (
          <div className="nested">
            {value.map((item, index) => (
              <DynamicFieldEditor
                key={index}
                label={`${index}`}
                path={`${path}[${index}]`}
                value={item}
                onChange={(next) =>
                  onChange(value.map((old, i) => (i === index ? next : old)))
                }
                onDelete={() => onChange(value.filter((_, i) => i !== index))}
              />
            ))}
            <AddValue onAdd={(item) => onChange([...value, item])} />
          </div>
        )}
      </div>
    );
  }
  const object = value as JsonObject;
  const entries = Object.entries(object);
  const renderEntry = ([key, item]: [string, JsonValue]) => (
    <DynamicFieldEditor
      key={key}
      label={key}
      path={path ? `${path}.${key}` : key}
      value={item}
      onChange={(next) => onChange({ ...object, [key]: next })}
      onDelete={() => {
        const next = { ...object };
        delete next[key];
        onChange(next);
      }}
    />
  );
  if (label === undefined && path === "") {
    const primaryNames = new Set([
      "question",
      "thinking",
      "answer",
      "prompt",
      "response",
      "instruction",
      "input",
      "output",
    ]);
    let primary = entries.filter(([key]) =>
      primaryNames.has(key.toLowerCase()),
    );
    let secondary = entries.filter(
      ([key]) => !primaryNames.has(key.toLowerCase()),
    );
    if (!primary.length || !secondary.length) {
      const midpoint = Math.ceil(entries.length / 2);
      primary = entries.slice(0, midpoint);
      secondary = entries.slice(midpoint);
    }
    const preferred = [
      ...primary,
      ...secondary.filter(([key]) => key.toLowerCase() === "messages"),
      ...secondary.filter(([key]) => key.toLowerCase() !== "messages"),
    ];
    return (
      <RootFieldLayout
        entries={preferred}
        object={object}
        onChange={onChange}
        layoutKey={layoutKey}
        renderEntry={renderEntry}
      />
    );
  }

  return (
    <div className="field group-field">
      {header}
      <button className="collapse" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown /> : <ChevronRight />}
        {Object.keys(object).length} fields
      </button>
      {open && (
        <div className="nested">
          {entries.map(renderEntry)}
          <AddField object={object} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function RootFieldLayout({
  entries,
  object,
  onChange,
  layoutKey = "default",
  renderEntry,
}: {
  entries: Array<[string, JsonValue]>;
  object: JsonObject;
  onChange: (value: JsonValue) => void;
  layoutKey?: string;
  renderEntry: (entry: [string, JsonValue]) => ReactElement;
}) {
  const storageKey = `dataset-studio:field-layout:${layoutKey}`;
  const entryKeys = entries.map(([key]) => key).join("\0");
  const [order, setOrder] = useState(() => entries.map(([key]) => key));
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [dragged, setDragged] = useState<string>();

  useEffect(() => {
    const defaultOrder = entryKeys ? entryKeys.split("\0") : [];
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as {
        order?: unknown;
        locked?: unknown;
      };
      const savedOrder = Array.isArray(saved.order)
        ? saved.order.filter((key): key is string => typeof key === "string")
        : [];
      setOrder([
        ...savedOrder.filter((key) => defaultOrder.includes(key)),
        ...defaultOrder.filter((key) => !savedOrder.includes(key)),
      ]);
      setLocked(
        saved.locked && typeof saved.locked === "object"
          ? (saved.locked as Record<string, boolean>)
          : {},
      );
    } catch {
      setOrder(defaultOrder);
      setLocked({});
    }
  }, [storageKey, entryKeys]);

  const persist = (nextOrder: string[], nextLocked: Record<string, boolean>) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ order: nextOrder, locked: nextLocked }),
    );
  };
  const move = (target: string) => {
    if (!dragged || dragged === target || locked[dragged] || locked[target]) return;
    const next = [...order];
    next.splice(next.indexOf(dragged), 1);
    next.splice(next.indexOf(target), 0, dragged);
    setOrder(next);
    persist(next, locked);
  };
  const byKey = new Map<string, [string, JsonValue]>(
    entries.map((entry) => [entry[0], entry]),
  );
  return (
    <div className="root-field-layout" aria-label="Record fields">
      {order.map((key) => {
        const entry = byKey.get(key);
        if (!entry) return null;
        return (
          <section
            className={`field-tile${locked[key] ? " field-tile-locked" : ""}`}
            data-field-key={key}
            key={key}
            draggable={!locked[key]}
            onDragStart={(event) => {
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", key);
              }
              setDragged(key);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => move(key)}
            onDragEnd={() => setDragged(undefined)}
            data-dragging={dragged === key ? "true" : undefined}
          >
            <div className="field-tile-actions">
              <button
                className="icon-button"
                aria-label={`${locked[key] ? "Unlock" : "Lock"} ${key}`}
                onClick={() => {
                  const next = { ...locked, [key]: !locked[key] };
                  setLocked(next);
                  persist(order, next);
                }}
              >
                {locked[key] ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
            </div>
            {renderEntry(entry)}
          </section>
        );
      })}
      <section className="field-tile field-tile-add">
        <AddField object={object} onChange={onChange} />
      </section>
    </div>
  );
}

function AddValue({ onAdd }: { onAdd: (value: JsonValue) => void }) {
  const [kind, setKind] = useState("string");
  return (
    <div className="add-row">
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {["string", "number", "boolean", "null", "object", "array"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <button onClick={() => onAdd(defaultValue(kind))}>
        <Plus size={14} /> Add item
      </button>
    </div>
  );
}

function AddField({
  object,
  onChange,
}: {
  object: JsonObject;
  onChange: (value: JsonValue) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("string");
  const add = () => {
    const key = name.trim();
    if (!key || key in object) return;
    onChange({ ...object, [key]: defaultValue(kind) });
    setName("");
  };
  return (
    <div className="add-row">
      <input
        aria-label="New field name"
        placeholder="field_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {["string", "number", "boolean", "null", "object", "array"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <button onClick={add}>
        <Plus size={14} /> Add field
      </button>
    </div>
  );
}
