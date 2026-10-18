import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A small menu at the pointer, closed by a click outside it or Escape. */
export function ContextMenu({
  at,
  close,
  children,
  label,
}: {
  at: { x: number; y: number };
  close(): void;
  children: ReactNode;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [close]);
  return createPortal(
    <div
      ref={box}
      className="dropdown context-menu"
      role="menu"
      aria-label={label}
      style={{
        left: Math.min(at.x, innerWidth - 230),
        top: Math.min(at.y, innerHeight - 270),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
