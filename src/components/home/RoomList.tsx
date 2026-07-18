import { useState } from "react";
import { Plus, Users, Sparkles, RefreshCw, Clock, Lock, Zap } from "lucide-react";
import { useTabs } from "@/lib/tabs";
import { useAuth } from "@/lib/auth";
import { useRooms, joinRoom, BRACKET_LABELS, type Bracket, type Room } from "@/lib/rooms";
import { formatElapsed, useNow } from "@/lib/time";
import CreateRoomModal, { BRACKET_TONE } from "@/components/rooms/CreateRoomModal";
import JoinPasswordModal from "@/components/rooms/JoinPasswordModal";

function BracketBadge({ bracket }: { bracket: Bracket }) {
  const tone = BRACKET_TONE[bracket];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${tone.bg} ${tone.text} ${tone.border}`}
      title={`Bracket ${bracket} — ${BRACKET_LABELS[bracket]}`}
    >
      <Zap size={11} /> B{bracket}
    </span>
  );
}

export default function RoomList() {
  const { openOrFocus } = useTabs();
  const { user } = useAuth();
  const { rooms, loading, error, refetch } = useRooms();
  const now = useNow(60_000);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState<Room | null>(null);

  const openRoomTab = (room: Room) => {
    openOrFocus({
      id: `game-${room.id}`,
      type: "game",
      title: room.name,
      data: { roomId: room.id },
    });
  };

  const handleJoin = async (room: Room) => {
    if (!user) return;
    setJoiningId(room.id);
    setJoinError(null);
    try {
      // The RPC is idempotent for existing members (host / already-joined) —
      // it returns success without checking password. So we always try a
      // passwordless join first: existing members succeed, non-members of
      // private rooms fail with "Incorrect password" and we prompt.
      await joinRoom(room.id);
      openRoomTab(room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to join room";
      if (!room.is_public && /password/i.test(msg)) {
        // Non-member joining a private room → open password modal instead of
        // showing the raw error.
        setPasswordPromptRoom(room);
      } else {
        setJoinError(msg);
      }
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-modern text-2xl font-semibold tracking-tight text-text-primary">
            Active Rooms
          </h1>
          <p className="text-sm text-text-muted">
            {loading ? "Loading…" : `${rooms.length} rooms · join one or start your own`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refetch()}
            className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-sm font-semibold text-white shadow-glow flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> Create room
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {joinError && (
        <div className="mb-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {joinError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1 space-y-2">
        {!loading && rooms.length === 0 && (
          <div className="h-full min-h-[240px] flex items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-bg-elevated border border-border-subtle mb-3">
                <Sparkles size={20} className="text-accent" />
              </div>
              <div className="text-text-primary font-medium">No open rooms</div>
              <div className="text-sm text-text-muted mt-1">
                Be the first — click <span className="text-text-primary font-medium">Create room</span> to start one.
              </div>
            </div>
          </div>
        )}

        {rooms.map((room) => {
          const full = room.current_players >= room.capacity;
          const joining = joiningId === room.id;
          return (
            <button
              key={room.id}
              onClick={() => void handleJoin(room)}
              disabled={joining}
              className="w-full text-left rounded-lg bg-bg-surface hover:bg-bg-elevated border border-border-subtle hover:border-border-strong transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {!room.is_public && (
                      <Lock size={12} className="text-text-muted shrink-0" aria-label="Private room" />
                    )}
                    <h3 className="font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
                      {room.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-text-muted">
                    <Clock size={11} />
                    <span>open {formatElapsed(room.created_at, now)}</span>
                  </div>
                </div>
                <BracketBadge bracket={room.max_bracket} />
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-base border border-border-subtle">
                  <Users size={14} className="text-text-muted" />
                  <span className="text-sm font-medium text-text-primary tabular-nums">
                    {room.current_players}
                    <span className="text-text-muted">/{room.capacity}</span>
                  </span>
                </div>
                <div className="text-xs font-medium text-text-muted min-w-[3.5rem] text-right">
                  {joining ? "Joining…" : full ? "Full" : "Join"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <CreateRoomModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={openRoomTab}
      />

      <JoinPasswordModal
        room={passwordPromptRoom}
        onClose={() => setPasswordPromptRoom(null)}
        onJoined={(room) => {
          setPasswordPromptRoom(null);
          openRoomTab(room);
        }}
      />
    </div>
  );
}
