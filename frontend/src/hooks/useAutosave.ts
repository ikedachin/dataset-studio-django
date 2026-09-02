import { useCallback, useEffect, useRef, useState } from "react";
import { api, jsonBody } from "../api/client";
import type { JsonObject, RecordDetail } from "../types";

export type SaveState = "saved" | "saving" | "unsaved" | "error";
export function useAutosave(
  record: RecordDetail | undefined,
  data: JsonObject,
  onSaved: (record: RecordDetail) => void,
) {
  const [state, setState] = useState<SaveState>("saved");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(data);
  const version = useRef(record?.version);
  const dirty = useRef(false);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  useEffect(() => {
    version.current = record?.version;
    dirty.current = false;
    setState("saved");
    // save() advances versions; a version change must not clear edits made mid-save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);
  const save = useCallback(async () => {
    if (!record || !dirty.current) return;
    window.clearTimeout(timer.current);
    dirty.current = false;
    setState("saving");
    try {
      const result = await api<RecordDetail>(`/records/${record.id}/`, {
        method: "PATCH",
        ...jsonBody({ version: version.current, data: latest.current }),
      });
      version.current = result.version;
      setState(dirty.current ? "unsaved" : "saved");
      onSaved(result);
    } catch {
      dirty.current = true;
      setState("error");
    }
  }, [record, onSaved]);
  const markDirty = useCallback(() => {
    dirty.current = true;
    setState("unsaved");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 750);
  }, [save]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { state, markDirty, save };
}
