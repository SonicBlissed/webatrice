import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, AlertTriangle, ChevronDown, Lock, Globe, Eye, EyeOff, Zap } from "lucide-react";
import {
  BRACKET_LABELS,
  createRoom,
  createRoomSchema,
  type Bracket,
  type Room,
} from "@/lib/rooms";
import { useAuth } from "@/lib/auth";

const CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const BRACKET_OPTIONS: Bracket[] = [1, 2, 3, 4, 5];

// Color coding used both in the modal and the room list — kept aligned with
// the intuitive "green = chill, red = tuned" mapping.
export const BRACKET_TONE: Record<Bracket, { text: string; bg: string; border: string }> = {
  1: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  2: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  3: { text: "text-yellow-300",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40"  },
  4: { text: "text-red-300",     bg: "bg-red-500/15",     border: "border-red-500/40"     },
  5: { text: "text-red-300",     bg: "bg-red-500/15",     border: "border-red-500/40"     },
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (room: Room) => void;
};

export default function CreateRoomModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<number>(4);
  const [isPublic, setIsPublic] = useState<boolean>(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [maxBracket, setMaxBracket] = useState<Bracket>(3);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCapacity(4);
    setIsPublic(true);
    setPassword("");
    setShowPassword(false);
    setMaxBracket(3);
    setSubmitting(false);
    setErrors([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrors([]);
    const parsed = createRoomSchema.safeParse({
      name,
      capacity,
      is_public: isPublic,
      password: isPublic ? undefined : password,
      max_bracket: maxBracket,
    });
    if (!parsed.success) {
      // Preserve field order + de-dupe (min/max on the same field can both fire)
      const seen = new Set<string>();
      const messages: string[] = [];
      for (const issue of parsed.error.issues) {
        if (seen.has(issue.message)) continue;
        seen.add(issue.message);
        messages.push(issue.message);
      }
      setErrors(messages);
      return;
    }
    setSubmitting(true);
    try {
      const room = await createRoom(parsed.data);
      onCreated(room);
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to create room"]);
      setSubmitting(false);
    }
  };

  const tone = BRACKET_TONE[maxBracket];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <h2 className="font-modern text-xl font-semibold text-text-primary">
          Create a Commander room
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Configure your room. You can leave it any time.
        </p>

        <div className="mt-5 space-y-4">
          {/* Room name */}
          <label className="block">
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
              Room name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              className="mt-1 w-full bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
          </label>

          {/* Seats */}
          <label className="block">
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
              Seats
            </span>
            <div className="relative mt-1">
              <select
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="appearance-none w-full bg-bg-base border border-border-subtle rounded-md pl-3 pr-9 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              >
                {CAPACITY_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            </div>
          </label>

          {/* Public / Private */}
          <div>
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
              Visibility
            </span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={[
                  "flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium border transition-colors",
                  isPublic
                    ? "bg-accent/15 border-accent text-text-primary"
                    : "bg-bg-base border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong",
                ].join(" ")}
              >
                <Globe size={14} /> Public
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={[
                  "flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium border transition-colors",
                  !isPublic
                    ? "bg-accent/15 border-accent text-text-primary"
                    : "bg-bg-base border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong",
                ].join(" ")}
              >
                <Lock size={14} /> Private
              </button>
            </div>
            {!isPublic && (
              <p className="text-xs text-text-muted mt-1.5">Password protected</p>
            )}
          </div>

          {/* Password (only when private) */}
          {!isPublic && (
            <label className="block">
              <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Password
              </span>
              <div className="relative mt-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={60}
                  placeholder="pick something you can share"
                  className="w-full bg-bg-base border border-border-subtle rounded-md pl-3 pr-9 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary rounded"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          )}

          {/* Max bracket */}
          <div>
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
              Max bracket
            </span>
            <div className="mt-1 flex gap-1">
              {BRACKET_OPTIONS.map((b) => {
                const active = maxBracket === b;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setMaxBracket(b)}
                    className={[
                      "flex-1 py-2 rounded-md text-sm font-semibold border tabular-nums transition-colors",
                      active
                        ? "bg-accent/15 border-accent text-text-primary"
                        : "bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border-strong",
                    ].join(" ")}
                    title={BRACKET_LABELS[b]}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
            <p className={`text-xs mt-1.5 flex items-center gap-1 ${tone.text}`}>
              <Zap size={12} /> Bracket {maxBracket} — {BRACKET_LABELS[maxBracket]}
            </p>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {errors.length === 1 ? (
              <span>{errors[0]}</span>
            ) : (
              <ul className="space-y-0.5 list-disc list-inside">
                {errors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-glow transition-colors flex items-center gap-2"
          >
            <Plus size={14} /> {submitting ? "Creating…" : "Create room"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
