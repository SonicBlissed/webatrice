import { useEffect, useState } from "react";
import { Save, User, Crown, Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useProfile, type Role } from "@/lib/profile";

function RoleBadge({ role }: { role: Role }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/15 text-yellow-300 border border-yellow-500/40">
        <Crown size={11} /> Admin
      </span>
    );
  }
  if (role === "mod") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-accent/15 text-accent border border-accent/40">
        <Shield size={11} /> Moderator
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-bg-elevated text-text-secondary border border-border-subtle">
      Player
    </span>
  );
}

export default function Profile() {
  const { profile, loading, error, update } = useProfile();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
  }, [profile?.display_name]);

  if (loading && !profile) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Loading profile…
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-400 mb-3" size={32} />
          <div className="text-text-primary font-medium mb-1">Couldn't load your profile</div>
          <div className="text-sm text-text-muted">{error}</div>
          <div className="text-xs text-text-muted mt-4">
            If this is your first sign-in, the profile row should have been created
            automatically by the trigger. Check that migration <span className="font-mono">0001_profiles.sql</span> ran.
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const dirty = displayName !== (profile.display_name ?? "");
  const trimmed = displayName.trim();
  const canSave = dirty && trimmed.length > 0 && !saving;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await update({ display_name: trimmed });
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-20 w-20 rounded-full border-2 border-border-strong"
            />
          ) : (
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center">
              <User size={32} className="text-white" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-modern text-2xl font-semibold tracking-tight text-text-primary truncate">
              {profile.display_name ?? profile.username ?? "Unnamed"}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {profile.username && (
                <span className="text-sm text-text-muted">@{profile.username}</span>
              )}
              <RoleBadge role={profile.role} />
            </div>
          </div>
        </div>

        {/* Editable card */}
        <section className="rounded-xl bg-bg-surface border border-border-subtle p-6 space-y-4">
          <div>
            <h2 className="font-modern text-lg font-semibold text-text-primary">Display name</h2>
            <p className="text-xs text-text-muted mt-1">
              Shown to other players in games, chat, and the player list. You can change
              this any time.
            </p>
          </div>

          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder={profile.username ?? "Display name"}
            className="w-full bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-glow transition-colors flex items-center gap-2"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save"}
            </button>

            {savedAt && !dirty && !saveError && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
            {saveError && (
              <span className="inline-flex items-center gap-1 text-xs text-red-400">
                <AlertTriangle size={14} /> {saveError}
              </span>
            )}
          </div>
        </section>

        {/* Read-only account info */}
        <section className="rounded-xl bg-bg-surface border border-border-subtle p-6">
          <h2 className="font-modern text-lg font-semibold text-text-primary mb-4">Account</h2>
          <dl className="grid grid-cols-3 gap-y-3 text-sm">
            <dt className="text-text-muted">Discord username</dt>
            <dd className="col-span-2 text-text-primary">
              {profile.username ? `@${profile.username}` : "—"}
            </dd>
            <dt className="text-text-muted">Role</dt>
            <dd className="col-span-2"><RoleBadge role={profile.role} /></dd>
            <dt className="text-text-muted">Joined</dt>
            <dd className="col-span-2 text-text-primary">
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                year: "numeric", month: "long", day: "numeric",
              })}
            </dd>
            <dt className="text-text-muted">User ID</dt>
            <dd className="col-span-2 font-mono text-xs text-text-secondary truncate">{profile.id}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
