import { useRef, useCallback } from "react";

interface ResizeHandleProps {
  /** Called with the incremental pixel delta on each mouse-move during drag. */
  onDelta: (delta: number) => void;
  className?: string;
}

export function ResizeHandle({ onDelta, className = "" }: ResizeHandleProps) {
  const lastX = useRef(0);
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDeltaRef.current(delta);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`w-1 shrink-0 cursor-col-resize select-none bg-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)] ${className}`}
      onMouseDown={handleMouseDown}
    />
  );
}
