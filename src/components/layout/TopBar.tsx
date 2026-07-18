import { useEffect, useRef, useState } from "react";
import {
  User, Library, LogOut, UserCircle2, Crown, Shield,
  Home as HomeIcon, LibraryBig, Swords, X, Maximize2,
  type LucideIcon,
} from "lucide-react";
import { useTabs, type TabType } from "@/lib/tabs";
import { useAuth } from "@/lib/auth";
import { useProfile, type Role } from "@/lib/profile";
import {
  CARD_SCALE_MAX,
  CARD_SCALE_MIN,
  useCardScale,
} from "@/lib/cardScale";

const TAB_ICONS: Record<TabType, LucideIcon> = {
  lobby: HomeIcon,
  "my-decks": LibraryBig,
  deck: Library,
  game: Swords,
  profile: UserCircle2,
};

function TabList() {
  const { tabs, activeTabId, activate, close } = useTabs();
  return (
    <div className="flex items-end h-full gap-0.5 overflow-x-auto overflow-y-hidden min-w-0">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.type];
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => activate(tab.id)}
            onAuxClick={(e) => {
              // middle-click closes, like a browser
              if (e.button === 1 && tab.closeable) {
                e.preventDefault();
                close(tab.id);
              }
            }}
            className={[
              "group relative flex items-center gap-2 h-9 pl-3 pr-2 rounded-t-md cursor-pointer select-none min-w-[140px] max-w-[220px] shrink-0 transition-colors",
              active
                ? "bg-bg-base text-text-primary border border-b-0 border-border-subtle"
                : "bg-bg-elevated/40 text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
            ].join(" ")}
          >
            <Icon size={14} className={active ? "text-accent" : "text-text-muted"} />
            <span className="flex-1 text-sm truncate">{tab.title}</span>
            {tab.closeable ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                className="p-0.5 rounded hover:bg-border-subtle text-text-muted hover:text-text-primary opacity-60 group-hover:opacity-100 transition-opacity"
                title="Close tab"
              >
                <X size={12} />
              </button>
            ) : (
              <span className="w-4" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "admin") {
    return <Crown size={12} className="text-yellow-400 shrink-0" aria-label="Admin" />;
  }
  if (role === "mod") {
    return <Shield size={12} className="text-accent shrink-0" aria-label="Moderator" />;
  }
  return null;
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { openOrFocus } = useTabs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Prefer profile fields; fall back to OAuth metadata during the initial load
  // so the top bar isn't empty for the first ~100ms after sign in.
  const meta = user?.user_metadata ?? {};
  const displayName =
    profile?.display_name ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user?.email ??
    "Signed in";
  const username = profile?.username ?? (meta.name as string | undefined) ?? null;
  const avatarUrl = profile?.avatar_url ?? (meta.avatar_url as string | undefined) ?? null;
  const role: Role = profile?.role ?? "user";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 py-1 rounded-md bg-bg-elevated hover:bg-border-subtle transition-colors"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full" />
        ) : (
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center">
            <User size={14} className="text-white" />
          </div>
        )}
        <span className="text-sm font-medium text-text-primary max-w-[10rem] truncate">
          {displayName}
        </span>
        <RoleBadge role={role} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg bg-bg-surface border border-border-subtle shadow-glow py-1 z-50">
          <div className="px-3 py-2 border-b border-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary truncate">{displayName}</span>
              <RoleBadge role={role} />
            </div>
            {username && (
              <div className="text-xs text-text-muted truncate">@{username}</div>
            )}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              openOrFocus({ id: "profile", type: "profile", title: "Profile" });
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <UserCircle2 size={14} /> Profile
          </button>
          <button
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ScaleMenu() {
  const { scale, setScale } = useCardScale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
        title="Scale in-game cards + card-sized UI"
      >
        <Maximize2 size={16} /> Scale
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg bg-bg-surface border border-border-subtle shadow-glow p-3 z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Card Size
            </span>
            <span className="text-xs tabular-nums text-text-secondary">
              {scale.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min={CARD_SCALE_MIN}
            max={CARD_SCALE_MAX}
            step={0.01}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[0.65rem] text-text-muted mt-1 tabular-nums">
            <span>{CARD_SCALE_MIN.toFixed(2)}x</span>
            <span>{CARD_SCALE_MAX.toFixed(2)}x</span>
          </div>
          <button
            onClick={() => setScale(1)}
            className="w-full mt-3 text-xs text-text-secondary hover:text-text-primary underline decoration-dotted underline-offset-2"
          >
            Reset to 1x
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const { openOrFocus } = useTabs();

  return (
    <header className="relative z-40 h-14 shrink-0 bg-bg-surface/80 backdrop-blur-md">
      <div className="flex h-full items-center">
        <div className="flex items-center gap-2 shrink-0 pl-6 pr-4">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-accent to-accent-secondary shadow-glow" />
          <span className="font-display text-xl font-bold tracking-wide text-text-primary">
            Webatrice
          </span>
        </div>

        <div className="w-px h-6 bg-border-subtle shrink-0" />

        {/* Tabs occupy the middle, no horizontal padding so they can extend
            edge-to-edge within the tab area. */}
        <div className="flex-1 min-w-0 h-full px-4">
          <TabList />
        </div>

        <div className="flex items-center gap-2 shrink-0 pl-4 pr-6">
          <button
            onClick={() =>
              openOrFocus({ id: "my-decks", type: "my-decks", title: "My Decks" })
            }
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            title="View your decks"
          >
            <Library size={16} /> Decks
          </button>
          <ScaleMenu />
          <div className="w-px h-6 bg-border-subtle mx-1" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
