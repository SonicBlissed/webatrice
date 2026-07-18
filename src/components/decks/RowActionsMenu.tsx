import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Crown, Layers, Minus, Plus, Trash2, ChevronDown, Archive, PackageOpen,
} from "lucide-react";
import type { DeckCard, DeckCategory } from "@/lib/decks";

/**
 * Kebab-menu of per-row actions on a DeckList row. Consolidates what were
 * five inline icons into a single ⋯ button + dropdown; the dropdown is
 * portal-rendered so it can escape the column layout's `break-inside-avoid`
 * containment and clip-free position over any content.
 */

type Props = {
  card: DeckCard;
  onInc: () => void;
  onDec: () => void;
  onDelete: () => void;
  onToggleCommander: () => void;
  onChangePrinting: () => void;
  onSetCategory: (category: DeckCategory) => void;
};

export default function RowActionsMenu({
  card, onInc, onDec, onDelete, onToggleCommander, onChangePrinting, onSetCategory,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const closeMenu = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const MENU_WIDTH = 220;
    const MENU_ESTIMATED_HEIGHT = 260;
    const EDGE = 8;

    // Prefer opening to the left of the button; flip right if there's no room.
    let left = rect.right - MENU_WIDTH;
    if (left < EDGE) left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - EDGE);

    // Prefer below; flip above if it would overflow the viewport.
    let top = rect.bottom + 4;
    if (top + MENU_ESTIMATED_HEIGHT > window.innerHeight) {
      top = Math.max(EDGE, rect.top - MENU_ESTIMATED_HEIGHT - 4);
    }
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isCommander = card.category === "commander";
  const isSideboard = card.category === "sideboard";

  const runAndClose = (fn: () => void) => () => {
    fn();
    closeMenu();
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary"
        title="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown size={14} />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 w-[220px] rounded-lg bg-bg-surface border border-border-subtle shadow-glow py-1"
            style={{ left: pos.left, top: pos.top }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Quantity inline */}
            <div className="px-3 py-1.5 flex items-center justify-between text-xs">
              <span className="text-text-secondary">Quantity</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={onDec}
                  className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary"
                  title="Remove one"
                  aria-label="Decrease quantity"
                >
                  <Minus size={12} />
                </button>
                <span className="w-6 text-center tabular-nums text-text-primary font-semibold text-sm">
                  {card.quantity}
                </span>
                <button
                  onClick={onInc}
                  className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary"
                  title="Add one"
                  aria-label="Increase quantity"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            <div className="border-t border-border-subtle my-1" />

            <MenuItem
              icon={<Layers size={13} />}
              label="Change printing"
              onClick={runAndClose(onChangePrinting)}
            />
            <MenuItem
              icon={<Crown size={13} className={isCommander ? "text-yellow-400" : ""} />}
              label={isCommander ? "Unmark as commander" : "Mark as commander"}
              onClick={runAndClose(onToggleCommander)}
            />
            {isSideboard ? (
              <MenuItem
                icon={<PackageOpen size={13} />}
                label="Move to main"
                onClick={runAndClose(() => onSetCategory("main"))}
              />
            ) : (
              <MenuItem
                icon={<Archive size={13} />}
                label="Move to sideboard"
                onClick={runAndClose(() => onSetCategory("sideboard"))}
              />
            )}

            <div className="border-t border-border-subtle my-1" />
            <MenuItem
              icon={<Trash2 size={13} />}
              label="Remove"
              danger
              onClick={runAndClose(onDelete)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
        danger
          ? "text-red-300 hover:bg-red-500/10"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
