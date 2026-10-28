import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** A layout setting kept in this browser. Storage can be missing or throw (private windows); the default then applies. */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : (JSON.parse(stored) as T);
    } catch {
      return fallback;
    }
  });
  const store = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered; the layout still changes.
      }
    },
    [key],
  );
  return [value, store];
}

interface HandleProps {
  label: string;
  /** The width of the column left of the handle, in pixels. */
  width: number;
  min: number;
  /** Computed when the drag starts, so it follows the window size. */
  max: () => number;
  onResize: (width: number) => void;
  onReset: () => void;
  disabled?: boolean;
}

/**
 * The bar between two columns: drag it, or focus it and use the arrow keys.
 * Double-click restores the default. While dragging, the body gets a class
 * that stops iframes (the artifact preview) from swallowing the pointer.
 */
export function ResizeHandle({ label, width, min, max, onResize, onReset, disabled }: HandleProps) {
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  const clamp = (value: number, upper: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, upper)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width, max: max() };
    document.body.classList.add("resizing");
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) onResize(clamp(start.width + event.clientX - start.x, start.max));
  };
  const end = () => {
    drag.current = null;
    document.body.classList.remove("resizing");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") onResize(clamp(width - step, max()));
    else if (event.key === "ArrowRight") onResize(clamp(width + step, max()));
    else if (event.key === "Home") onResize(min);
    else if (event.key === "Enter") onReset();
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={disabled ? "resize-handle disabled" : "resize-handle"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? undefined : `${label}: drag, or use the arrow keys. Double-click to reset.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={disabled ? undefined : onReset}
      onKeyDown={disabled ? undefined : onKeyDown}
    />
  );
}
