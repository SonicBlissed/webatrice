import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreVertical, Minus, X, Send, Circle } from "lucide-react";
import { useBuddyChat, useBuddy } from "@/lib/buddyChat";
import type { ChatMessage, PresenceStatus } from "@/lib/buddies";

const STATUS_COLOR: Record<PresenceStatus, string> = {
  "in-game": "text-purple-400 fill-purple-400",
  idle: "text-yellow-400 fill-yellow-400",
  online: "text-emerald-400 fill-emerald-400",
  offline: "text-text-muted fill-text-muted",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

function Avatar({ letter, size = 8 }: { letter: string; size?: 6 | 7 | 8 }) {
  const wh = size === 6 ? "h-6 w-6" : size === 7 ? "h-7 w-7" : "h-8 w-8";
  const text = size === 6 ? "text-[0.65rem]" : "text-xs";
  return (
    <div
      className={`${wh} rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center ${text} font-bold text-white shrink-0`}
    >
      {letter}
    </div>
  );
}

type Props = {
  buddyId: string;
  messages: ChatMessage[];
  /** Default starting position when no persisted one exists — used to
   *  cascade newly opened windows so they don't stack on each other. */
  defaultPosition: { x: number; y: number };
};

const WINDOW_W = 360;
const WINDOW_H = 500; // matches `h-[500px]` on the window
/** Gap left between the docked window and the viewport edge. */
const DOCK_INSET = 8;

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

/** If any side of the window is touching (or past) a viewport edge,
 *  compute where the window would snap on release. Whichever side is
 *  overhanging the most wins. Left/right dock keeps the user's Y
 *  (clamped); top/bottom dock keeps the user's X (clamped). */
function computeDockCandidate(
  pointerX: number,
  pointerY: number,
  offsetX: number,
  offsetY: number,
  size: Size,
): Pos | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const windowX = pointerX - offsetX;
  const windowY = pointerY - offsetY;
  // How far each side of the window has crossed the viewport edge.
  // >= 0 means that side is touching/past the edge.
  const overhangLeft = -windowX;
  const overhangRight = windowX + size.w - vw;
  const overhangTop = -windowY;
  const overhangBottom = windowY + size.h - vh;
  const max = Math.max(
    overhangLeft,
    overhangRight,
    overhangTop,
    overhangBottom,
  );
  if (max < 0) return null;

  const clampX = (x: number) =>
    Math.max(DOCK_INSET, Math.min(vw - size.w - DOCK_INSET, x));
  const clampY = (y: number) =>
    Math.max(DOCK_INSET, Math.min(vh - size.h - DOCK_INSET, y));

  if (max === overhangLeft) return { x: DOCK_INSET, y: clampY(windowY) };
  if (max === overhangRight)
    return { x: vw - size.w - DOCK_INSET, y: clampY(windowY) };
  if (max === overhangTop) return { x: clampX(windowX), y: DOCK_INSET };
  return { x: clampX(windowX), y: vh - size.h - DOCK_INSET };
}

/**
 * Floating, draggable buddy chat window. All state lives in
 * BuddyChatContext; this component just renders + handles the drag.
 * Position is persisted per buddy via the context (localStorage), and
 * on drag end the window snaps into the viewport so a window dragged
 * off-screen never becomes unreachable.
 */
export default function BuddyChatWindow({
  buddyId,
  messages,
  defaultPosition,
}: Props) {
  const buddy = useBuddy(buddyId);
  const {
    closeChat,
    minimizeChat,
    sendMessage,
    positions,
    setPosition,
  } = useBuddyChat();

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever a new message arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Position: prefer a persisted position; fall back to the caller-
  // provided default (cascaded by the manager). Kept in a local `pos`
  // state so the drag updates every frame without touching localStorage
  // 60×/sec.
  const stored = positions[buddyId];
  const [pos, setPos] = useState<{ x: number; y: number }>(
    () => stored ?? defaultPosition,
  );
  // If the stored position changes underneath us (e.g. localStorage
  // rehydrated), sync once.
  useLayoutEffect(() => {
    if (stored) setPos(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buddyId]);

  // Drag state — pointer offset from window top-left at drag start,
  // plus the window's measured size (used both for the dock candidate
  // math and for sizing the preview overlay).
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const dragSize = useRef<Size>({ w: WINDOW_W, h: WINDOW_H });
  // Ref mirrors the state so the pointerup handler (which reads from a
  // closure captured on drag start) can see the latest candidate.
  const dockCandidateRef = useRef<Pos | null>(null);
  const [dockCandidate, setDockCandidate] = useState<Pos | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const off = dragOffset.current;
      if (!off) return;
      setPos({ x: e.clientX - off.x, y: e.clientY - off.y });
      const cand = computeDockCandidate(
        e.clientX,
        e.clientY,
        off.x,
        off.y,
        dragSize.current,
      );
      dockCandidateRef.current = cand;
      setDockCandidate(cand);
    };
    const onUp = () => {
      dragOffset.current = null;
      setDragging(false);
      const cand = dockCandidateRef.current;
      dockCandidateRef.current = null;
      setDockCandidate(null);
      if (cand) {
        // Snap into the dock zone the user was hovering.
        setPos(cand);
        setPosition(buddyId, cand);
        return;
      }
      // Otherwise clamp so a mis-drag can't strand the window.
      setPos((p) => {
        const clamped = clampToViewport(p);
        setPosition(buddyId, clamped);
        return clamped;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, buddyId, setPosition]);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return; // don't drag when clicking header buttons
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragSize.current = { w: rect.width, h: rect.height };
    setDragging(true);
  };

  const send = () => {
    if (!draft.trim()) return;
    sendMessage(buddyId, draft);
    setDraft("");
  };

  if (!buddy) return null;

  return (
    <>
      {/* Dock preview — shown while dragging near a viewport edge so the
          user sees exactly where the window will land on release. Sits
          below the window (z-40) so the window still tracks the pointer
          on top. */}
      {dragging && dockCandidate && (
        <div
          className="fixed z-40 pointer-events-none rounded-xl border-2 border-dashed border-accent bg-accent/15"
          style={{
            left: dockCandidate.x,
            top: dockCandidate.y,
            width: dragSize.current.w,
            height: dragSize.current.h,
          }}
        />
      )}
    <div
      ref={windowRef}
      className="fixed z-50 pointer-events-auto w-[360px] h-[500px] max-h-[85vh] flex flex-col rounded-xl bg-bg-surface border border-border-subtle shadow-glow overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header (drag handle) */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={[
          "shrink-0 flex items-center gap-2 px-3 py-2 bg-accent/20 border-b border-border-subtle select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        ].join(" ")}
      >
        <div className="relative">
          <Avatar letter={buddy.name[0]} size={7} />
          <Circle
            size={9}
            className={`absolute -bottom-0.5 -right-0.5 ${STATUS_COLOR[buddy.status]} stroke-bg-surface`}
            strokeWidth={3}
          />
        </div>
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary">
          {buddy.name}
        </span>
        <button
          type="button"
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          title="More"
          aria-label="More"
        >
          <MoreVertical size={16} />
        </button>
        <button
          type="button"
          onClick={() => minimizeChat(buddyId)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={() => closeChat(buddyId)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          title="Close"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-bg-base/40"
      >
        {messages.length === 0 && (
          <div className="text-center text-xs text-text-muted py-6">
            No messages yet — say hi!
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === "me";
          const prev = messages[i - 1];
          const showTime = !prev || m.sentAt - prev.sentAt > 5 * 60 * 1000;
          return (
            <div key={m.id}>
              {showTime && (
                <div className="text-center text-[0.65rem] text-text-muted py-1">
                  {fmtTime(m.sentAt)}
                </div>
              )}
              <div
                className={[
                  "flex items-end gap-2",
                  mine ? "flex-row-reverse" : "flex-row",
                ].join(" ")}
              >
                <Avatar letter={mine ? "Y" : buddy.name[0]} size={6} />
                <div
                  className={[
                    "max-w-[75%] px-3 py-1.5 rounded-2xl text-sm break-words",
                    mine
                      ? "bg-accent text-white rounded-br-sm"
                      : "bg-bg-elevated text-text-primary rounded-bl-sm",
                  ].join(" ")}
                >
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border-subtle bg-bg-surface"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 min-w-0 px-3 py-2 rounded-md bg-bg-base border border-border-subtle text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="p-2 rounded-md text-accent hover:text-white hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent transition-colors"
          title="Send"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
    </>
  );
}

/** Keep at least 60px of the window on-screen so a bad drag can't
 *  strand it. Matches the search-library dialog's clamp pattern. */
function clampToViewport(pos: { x: number; y: number }): {
  x: number;
  y: number;
} {
  const minVisible = 60;
  return {
    x: Math.max(minVisible - WINDOW_W, Math.min(window.innerWidth - minVisible, pos.x)),
    y: Math.max(0, Math.min(window.innerHeight - minVisible, pos.y)),
  };
}
