import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A right-click context menu that overrides the browser's default menu.
 *
 * Wrap any element in `<ContextMenu items={…}>` and right-clicks anywhere
 * inside will:
 *   1. call `e.preventDefault()` to suppress the browser menu
 *   2. render a portal-based popup at the cursor position with the given items
 *   3. close on outside click, escape, or after an item's onClick fires
 *
 * Items with `disabled: true` render dimmed and don't fire onClick.
 * A `divider: true` item renders a horizontal line instead.
 */
export type ContextMenuItem =
  | {
      label: string;
      onClick: () => void;
      disabled?: boolean;
      /** Optional keyboard-shortcut hint shown right-aligned. */
      shortcut?: string;
    }
  | { divider: true };

type Props = {
  items: ContextMenuItem[];
  children: ReactNode;
};

export default function ContextMenu({ items, children }: Props) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!position) return;
    const onDown = (e: MouseEvent) => {
      // Any click anywhere (inside or outside the menu) dismisses it. Items
      // handle their own click first via onClick, which sets position=null
      // before this fires.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      setPosition(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPosition(null);
    };
    // Slight delay so the right-click that opened the menu doesn't immediately
    // close it via the mousedown listener.
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [position]);

  return (
    <>
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setPosition({ x: e.clientX, y: e.clientY });
        }}
      >
        {children}
      </div>
      {position &&
        createPortal(
          <div
            data-context-menu
            className="fixed z-[100] min-w-[160px] rounded-md border border-border-subtle bg-bg-surface shadow-glow py-1"
            style={{
              left: position.x,
              top: position.y,
            }}
          >
            {items.map((item, i) => {
              if ("divider" in item) {
                return (
                  <div
                    key={`d-${i}`}
                    className="my-1 border-t border-border-subtle"
                  />
                );
              }
              return (
                <button
                  key={`i-${i}`}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onClick();
                    setPosition(null);
                  }}
                  className="w-full flex items-center gap-4 px-3 py-1.5 text-sm text-left text-text-primary hover:bg-bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="text-xs text-text-muted">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
