import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MoreHorizontal, Circle, X } from "lucide-react";
import { useBuddyChat } from "@/lib/buddyChat";
import { MOCK_BUDDIES, type PresenceStatus } from "@/lib/buddies";

const STATUS_COLOR: Record<PresenceStatus, string> = {
  "in-game": "text-purple-400 fill-purple-400",
  idle: "text-yellow-400 fill-yellow-400",
  online: "text-emerald-400 fill-emerald-400",
  offline: "text-text-muted fill-text-muted",
};

const DOCK_POSITION_KEY = "webatrice.buddyChatDockPosition";
const DOCK_MARGIN = 16; // distance to snapped edge
const DRAG_THRESHOLD_PX = 4; // pointer must move this far to count as drag

type Position = { x: number; y: number };

function readStoredPosition(): Position | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DOCK_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number"
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore
  }
  return null;
}

function writeStoredPosition(pos: Position): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

/** Snap X to whichever of the left/right edges is closer, keeping Y
 *  wherever the user let go (clamped inside the viewport). The dock is
 *  a vertical stack so horizontal edges are the only ones that make
 *  sense visually. */
function snapToEdge(
  pos: Position,
  size: { w: number; h: number },
): Position {
  const centerX = pos.x + size.w / 2;
  const snappedX =
    centerX < window.innerWidth / 2
      ? DOCK_MARGIN
      : window.innerWidth - size.w - DOCK_MARGIN;
  const clampedY = Math.max(
    DOCK_MARGIN,
    Math.min(window.innerHeight - size.h - DOCK_MARGIN, pos.y),
  );
  return { x: snappedX, y: clampedY };
}

/**
 * Right-edge vertical dock. One row per active chat. Draggable — grab
 * the grip handle at the top and drop anywhere; the dock snaps
 * horizontally to whichever page edge is closer and clamps vertically
 * to stay on-screen. Position persists per browser via localStorage.
 */
export default function BuddyChatDock() {
  const { openChats, openChat, closeChat, simulateIncoming } = useBuddyChat();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // The dock only shows bubbles for *minimized* chats. Opening a chat
  // un-minimizes it (the bubble goes away); minimizing brings the
  // bubble back.
  const dockedChats = openChats.filter((c) => c.minimized);

  const [pos, setPos] = useState<Position | null>(null);

  // Place the dock on mount: persisted position wins; otherwise anchor
  // to bottom-right. useLayoutEffect so the first paint uses the
  // final position (no flash from a default in the top-left).
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const stored = readStoredPosition();
    const size = { w: rect.width, h: rect.height };
    if (stored) {
      setPos(snapToEdge(stored, size));
    } else {
      setPos({
        x: window.innerWidth - size.w - DOCK_MARGIN,
        y: window.innerHeight - size.h - DOCK_MARGIN,
      });
    }
    // Re-run when the number of docked chats changes so the anchored
    // position stays visually pinned to the corner as the dock grows /
    // shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockedChats.length]);

  // Close the menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  // Drag lifecycle:
  //   - `pressing` = pointer is down on the dock (but may not be a drag yet)
  //   - `hasMovedRef` flips true once movement exceeds DRAG_THRESHOLD_PX,
  //     promoting the press into a real drag
  //   - `justDraggedRef` is set on pointerup-after-drag and consulted by
  //     child button onClicks so a drag-release doesn't also fire the
  //     underlying button (open chat, toggle menu, close chat, etc.)
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false);
  const justDraggedRef = useRef(false);
  const [pressing, setPressing] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!pressing) return;
    const onMove = (e: PointerEvent) => {
      const off = dragOffset.current;
      const start = startPos.current;
      const el = dockRef.current;
      if (!off || !start || !el) return;
      if (!hasMovedRef.current) {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
        hasMovedRef.current = true;
        setDragging(true);
      }
      const size = { w: el.offsetWidth, h: el.offsetHeight };
      setPos({
        x: Math.max(
          -size.w + DRAG_THRESHOLD_PX,
          Math.min(window.innerWidth - DRAG_THRESHOLD_PX, e.clientX - off.x),
        ),
        y: Math.max(
          0,
          Math.min(window.innerHeight - DRAG_THRESHOLD_PX, e.clientY - off.y),
        ),
      });
    };
    const onUp = () => {
      const wasDrag = hasMovedRef.current;
      dragOffset.current = null;
      startPos.current = null;
      hasMovedRef.current = false;
      setPressing(false);
      setDragging(false);
      if (wasDrag) {
        // Suppress the click that would otherwise fire on the button
        // we happened to release over.
        justDraggedRef.current = true;
        // Defer the snap-position update by one frame so React first
        // commits `dragging=false` (which re-enables the CSS
        // transition), then the following pos change animates instead
        // of teleporting.
        requestAnimationFrame(() => {
          const el = dockRef.current;
          if (!el) return;
          const size = { w: el.offsetWidth, h: el.offsetHeight };
          setPos((p) => {
            if (!p) return p;
            const snapped = snapToEdge(p, size);
            writeStoredPosition(snapped);
            return snapped;
          });
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pressing]);

  const onDockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start a drag from inside the menu popup — those clicks are
    // meant for the menu.
    const target = e.target as HTMLElement | null;
    if (menuRef.current?.contains(target)) return;
    const el = dockRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    startPos.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;
    justDraggedRef.current = false;
    setPressing(true);
  };

  const consumeJustDragged = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return true;
    }
    return false;
  };

  const style = useMemo<React.CSSProperties>(
    () => ({
      ...(pos
        ? { left: pos.x, top: pos.y }
        : { left: -9999, top: -9999 }),
      // Instant tracking while dragging, smooth 250ms slide when
      // snapping back to an edge on release.
      transition: dragging
        ? "none"
        : "left 250ms ease-out, top 250ms ease-out",
    }),
    [pos, dragging],
  );

  // Nothing to show — no minimized chats, no dock. This also removes
  // the "..." menu bubble when there's no bubble stack to accompany it.
  if (dockedChats.length === 0) return null;

  return (
    <div
      ref={dockRef}
      onPointerDown={onDockPointerDown}
      className={[
        "fixed z-40 flex flex-col items-center gap-2 pointer-events-auto select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
      ].join(" ")}
      style={style}
    >
      {/* Menu */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            if (consumeJustDragged()) return;
            setMenuOpen((o) => !o);
          }}
          className="h-10 w-10 rounded-full bg-bg-surface border border-border-subtle text-text-muted hover:text-text-primary hover:bg-bg-elevated flex items-center justify-center shadow"
          title="Chat menu"
          aria-label="Chat menu"
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && (
          <div className="absolute right-full mr-2 top-0 w-56 rounded-md bg-bg-surface border border-border-subtle shadow-glow py-1 z-50">
            <div className="px-3 py-1.5 text-[0.65rem] uppercase tracking-wider text-text-muted">
              Simulate incoming from
            </div>
            {MOCK_BUDDIES.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  simulateIncoming(b.id);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
              >
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center text-[0.6rem] font-bold text-white shrink-0">
                  {b.name[0]}
                </div>
                <span className="truncate">{b.name}</span>
              </button>
            ))}
            <div className="my-1 border-t border-border-subtle" />
            <button
              type="button"
              onClick={() => {
                openChats.forEach((c) => closeChat(c.buddyId));
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
            >
              <X size={14} /> Close all chats
            </button>
          </div>
        )}
      </div>

      {/* Avatar stack, one per minimized chat */}
      {dockedChats.map((c) => {
        const buddy = MOCK_BUDDIES.find((b) => b.id === c.buddyId);
        if (!buddy) return null;
        return (
          <div key={c.buddyId} className="relative group">
            <button
              type="button"
              onClick={() => {
                if (consumeJustDragged()) return;
                openChat(c.buddyId);
              }}
              className={[
                "h-10 w-10 rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center text-sm font-bold text-white shadow transition-transform hover:scale-105",
                c.unread > 0
                  ? "ring-2 ring-accent ring-offset-2 ring-offset-bg-base"
                  : "",
              ].join(" ")}
              title={`Open chat with ${buddy.name}`}
              aria-label={`Open chat with ${buddy.name}`}
            >
              {buddy.name[0]}
            </button>
            <Circle
              size={11}
              className={`absolute -bottom-0.5 -right-0.5 ${STATUS_COLOR[buddy.status]} stroke-bg-surface pointer-events-none`}
              strokeWidth={3}
            />
            {c.unread > 0 && (
              <span
                className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[0.65rem] font-bold flex items-center justify-center pointer-events-none"
                aria-label={`${c.unread} unread message${c.unread === 1 ? "" : "s"}`}
              >
                {c.unread > 9 ? "9+" : c.unread}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (consumeJustDragged()) return;
                closeChat(c.buddyId);
              }}
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-bg-surface border border-border-subtle text-text-muted hover:text-text-primary hover:bg-bg-elevated flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Close chat"
              aria-label={`Close chat with ${buddy.name}`}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
