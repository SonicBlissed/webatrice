import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Discord's own brand mark — used inline so we don't need another icon package.
function DiscordIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.245.197.372.291a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.419 0 1.333-.956 2.42-2.157 2.42zm7.974 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.419 0 1.333-.946 2.42-2.157 2.42z" />
    </svg>
  );
}

export default function Login() {
  const { session, loading, signInWithDiscord } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;

  const handleSignIn = async () => {
    setError(null);
    setPending(true);
    try {
      await signInWithDiscord();
      // Supabase will navigate away to Discord; no further UI needed here.
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Sign in failed");
    }
  };

  return (
    <div className="h-full bg-bg-base bg-purple-radial flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-accent to-accent-secondary shadow-glow" />
            <span className="font-display text-3xl font-bold tracking-wide">Webatrice</span>
          </div>
          <p className="text-text-muted">Sign in with Discord to join a game</p>
        </div>

        <div className="rounded-xl bg-bg-surface border border-border-subtle p-6 shadow-glow">
          <button
            onClick={handleSignIn}
            disabled={pending}
            className="w-full py-3 rounded-md bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-3"
          >
            <DiscordIcon />
            {pending ? "Redirecting to Discord…" : "Continue with Discord"}
          </button>

          {error && (
            <div className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <p className="mt-4 text-xs text-text-muted text-center">
            We use your Discord username and avatar as your identity in the tavern.
          </p>
        </div>
      </div>
    </div>
  );
}
