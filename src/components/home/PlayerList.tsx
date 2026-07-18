import { Bell, Circle, Crown, Shield, UserPlus } from "lucide-react";
import {
  MOCK_BUDDIES,
  type Buddy,
  type PresenceStatus,
  type PlayerRole,
} from "@/lib/buddies";
import { useBuddyChat } from "@/lib/buddyChat";

type Player = {
  id: string;
  name: string;
  status: PresenceStatus;
  role: PlayerRole;
  activity?: string;
};

// Everyone else currently online (not on the viewer's buddy list). The
// buddy list above owns anyone the viewer has added; this is the "public
// lobby" showing who else is around.
const MOCK_ONLINE_STRANGERS: Player[] = [
  { id: "1", name: "Alice", status: "in-game", role: "admin", activity: "Casual EDH" },
  { id: "2", name: "Bob", status: "in-game", role: "user", activity: "Tuned cEDH pod" },
  { id: "3", name: "Charlie", status: "in-game", role: "mod", activity: "Legacy testing" },
  { id: "4", name: "Diana", status: "in-game", role: "user", activity: "Modern goldfishing" },
  { id: "5", name: "Evan", status: "in-game", role: "user", activity: "Pauper league prep" },
  { id: "6", name: "Fiona", status: "in-game", role: "user", activity: "Cube draft" },
  { id: "7", name: "Greg", status: "in-game", role: "user", activity: "Standard netdecks only" },
  { id: "8", name: "Hana", status: "idle", role: "user" },
  { id: "9", name: "Ivan", status: "online", role: "mod" },
  { id: "10", name: "Julia", status: "online", role: "user" },
  { id: "11", name: "Kai", status: "online", role: "user" },
  { id: "12", name: "Luna", status: "online", role: "user" },
];

const STATUS_COLOR: Record<PresenceStatus, string> = {
  "in-game": "text-purple-400 fill-purple-400",
  idle: "text-yellow-400 fill-yellow-400",
  online: "text-emerald-400 fill-emerald-400",
  offline: "text-text-muted fill-text-muted",
};

function RoleIcon({ role }: { role: PlayerRole }) {
  if (role === "admin") return <Crown size={12} className="text-yellow-400" />;
  if (role === "mod") return <Shield size={12} className="text-accent" />;
  return null;
}

function Avatar({ letter, size = 8 }: { letter: string; size?: 6 | 8 }) {
  const wh = size === 6 ? "h-6 w-6" : "h-8 w-8";
  const text = size === 6 ? "text-[0.65rem]" : "text-xs";
  return (
    <div
      className={`${wh} rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center ${text} font-bold text-white shrink-0`}
    >
      {letter}
    </div>
  );
}

function PlayerRow({
  player,
  onClick,
  clickable,
  onSimulateIncoming,
}: {
  player: Player | Buddy;
  onClick?: () => void;
  clickable?: boolean;
  /** Debug affordance: shown as a small bell icon on hover for buddy
   *  rows so the developer can trigger an incoming-message notification
   *  without a backend. */
  onSimulateIncoming?: () => void;
}) {
  const activityFallback = player.activity ?? (
    player.status === "idle"
      ? "idle"
      : player.status === "offline"
      ? "offline"
      : "in lobby"
  );
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        disabled={!clickable}
        className={[
          "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
          clickable
            ? "hover:bg-bg-elevated cursor-pointer"
            : "cursor-default",
        ].join(" ")}
      >
        <div className="relative">
          <Avatar letter={player.name[0]} />
          <Circle
            size={10}
            className={`absolute -bottom-0.5 -right-0.5 ${STATUS_COLOR[player.status]} stroke-bg-surface`}
            strokeWidth={3}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary truncate">
              {player.name}
            </span>
            <RoleIcon role={player.role} />
          </div>
          <div className="text-xs text-text-muted truncate">
            {activityFallback}
          </div>
        </div>
      </button>
      {onSimulateIncoming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSimulateIncoming();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated opacity-0 group-hover:opacity-100 transition-opacity"
          title="Simulate incoming message"
          aria-label="Simulate incoming message"
        >
          <Bell size={14} />
        </button>
      )}
    </div>
  );
}

export default function PlayerList() {
  const { openChat, simulateIncoming } = useBuddyChat();
  const buddies = MOCK_BUDDIES;
  const online = MOCK_ONLINE_STRANGERS;
  const onlineBuddies = buddies.filter((b) => b.status !== "offline").length;

  return (
    <aside className="flex h-full flex-col bg-bg-surface border-l border-border-subtle min-h-0">
      {/* Buddies section — top */}
      <div className="flex flex-col min-h-0 flex-1">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-widest text-text-secondary">
              Buddies
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {onlineBuddies} of {buddies.length} online
            </p>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
            title="Add buddy"
            aria-label="Add buddy"
          >
            <UserPlus size={16} />
          </button>
        </div>
        <ul className="overflow-y-auto py-2 min-h-0 flex-1">
          {buddies.length === 0 && (
            <li className="px-4 py-3 text-xs text-text-muted">
              No buddies yet — add someone from the players list below.
            </li>
          )}
          {buddies.map((b) => (
            <li key={b.id}>
              <PlayerRow
                player={b}
                clickable
                onClick={() => openChat(b.id)}
                onSimulateIncoming={() => simulateIncoming(b.id)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Players Online section — bottom */}
      <div className="flex flex-col min-h-0 flex-1 border-t border-border-subtle">
        <div className="px-4 py-3 border-b border-border-subtle shrink-0">
          <h2 className="font-display text-sm font-bold uppercase tracking-widest text-text-secondary">
            Players Online
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {online.length} people around the tavern
          </p>
        </div>
        <ul className="overflow-y-auto py-2 min-h-0 flex-1">
          {online.map((p) => (
            <li key={p.id}>
              <PlayerRow player={p} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
