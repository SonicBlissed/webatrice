import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Lock, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { joinRoom, type Room } from "@/lib/rooms";

type Props = {
  room: Room | null;
  onClose: () => void;
  onJoined: (room: Room) => void;
};

export default function JoinPasswordModal({ room, onClose, onJoined }: Props) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;
    setPassword("");
    setShowPassword(false);
    setSubmitting(false);
    setError(null);
  }, [room?.id]);

  useEffect(() => {
    if (!room) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [room, onClose]);

  if (!room) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Enter the room password");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await joinRoom(room.id, password);
      onJoined(room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to join";
      // Postgrest surfaces the RPC's raise-exception text under `message`.
      // "Incorrect password" comes back verbatim; other errors (full, closed)
      // land here too — surface whatever the server said.
      setError(msg);
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 text-text-muted">
          <Lock size={14} />
          <span className="text-xs font-medium uppercase tracking-wider">Private room</span>
        </div>
        <h2 className="font-modern text-xl font-semibold text-text-primary mt-1 truncate">
          {room.name}
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Ask the host for the password.
        </p>

        <label className="block mt-5">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
            Password
          </span>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={60}
              autoFocus
              className="w-full bg-bg-base border border-border-subtle rounded-md pl-3 pr-9 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
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

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
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
            className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-glow transition-colors"
          >
            {submitting ? "Joining…" : "Join"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
