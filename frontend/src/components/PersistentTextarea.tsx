import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

const PREFIX = "dataset-studio:textarea-height:";

export function PersistentTextarea({
  storageKey,
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { storageKey: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = Number(
        window.localStorage.getItem(`${PREFIX}${storageKey}`),
      );
      if (ref.current && Number.isFinite(stored) && stored >= 48) {
        ref.current.style.height = `${stored}px`;
      }
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
    }
  }, [storageKey]);

  const remember = () => {
    if (!ref.current) return;
    try {
      window.localStorage.setItem(
        `${PREFIX}${storageKey}`,
        String(ref.current.offsetHeight),
      );
    } catch {
      // Keep editing usable when storage is unavailable.
    }
  };

  return (
    <textarea
      ref={ref}
      style={style}
      {...props}
      wrap={props.wrap ?? "soft"}
      onPointerUp={(event) => {
        remember();
        props.onPointerUp?.(event);
      }}
    />
  );
}
