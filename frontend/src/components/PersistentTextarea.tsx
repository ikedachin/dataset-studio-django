import {
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

const PREFIX = "dataset-studio:textarea-height:";

export function PersistentTextarea({
  storageKey,
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { storageKey: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    try {
      const stored = Number(
        window.localStorage.getItem(`${PREFIX}${storageKey}`),
      );
      const savedHeight = Number.isFinite(stored) && stored >= 48 ? stored : 0;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(savedHeight, textarea.scrollHeight, 48)}px`;
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(textarea.scrollHeight, 48)}px`;
    }
  }, [storageKey, props.value]);

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
