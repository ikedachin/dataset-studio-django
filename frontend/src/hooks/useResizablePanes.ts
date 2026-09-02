import { useCallback, useEffect, useRef, useState } from "react";

type PaneSide = "left" | "right";
interface PaneWidths {
  left: number;
  right: number;
}
const STORAGE_KEY = "dataset-studio:pane-widths";
const DEFAULT_WIDTHS: PaneWidths = { left: 240, right: 300 };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function initialWidths(): PaneWidths {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "",
    ) as Partial<PaneWidths>;
    return {
      left: clamp(Number(saved.left) || DEFAULT_WIDTHS.left, 180, 420),
      right: clamp(Number(saved.right) || DEFAULT_WIDTHS.right, 220, 620),
    };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

export function useResizablePanes() {
  const [widths, setWidths] = useState<PaneWidths>(initialWidths);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      /* Resizing still works without storage. */
    }
  }, [widths]);
  useEffect(() => () => cleanupRef.current?.(), []);

  const nudge = useCallback((side: PaneSide, screenDelta: number) => {
    setWidths((current) =>
      side === "left"
        ? { ...current, left: clamp(current.left + screenDelta, 180, 420) }
        : { ...current, right: clamp(current.right - screenDelta, 220, 620) },
    );
  }, []);

  const startResize = useCallback(
    (side: PaneSide, startX: number) => {
      cleanupRef.current?.();
      const initial = widths[side];
      document.body.classList.add("pane-resizing");
      const move = (event: PointerEvent) => {
        const delta = event.clientX - startX;
        const maximumRight = Math.max(
          220,
          Math.min(620, window.innerWidth - 720),
        );
        setWidths((current) =>
          side === "left"
            ? { ...current, left: clamp(initial + delta, 180, 420) }
            : { ...current, right: clamp(initial - delta, 220, maximumRight) },
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", cleanup);
        document.body.classList.remove("pane-resizing");
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", cleanup);
    },
    [widths],
  );

  return { widths, startResize, nudge };
}
