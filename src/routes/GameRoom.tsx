import { useState } from "react";
import {
  Crown, User, AlertTriangle, Zap,
  CheckCircle2, Layers, Loader2, Play, FastForward, Eye,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTabs } from "@/lib/tabs";
import {
  useRoom, leaveRoom, setRoomDeckReady, startGame, BRACKET_LABELS,
  type RoomMemberWithProfile,
} from "@/lib/rooms";
import { BRACKET_TONE } from "@/components/rooms/CreateRoomModal";
import DeckSelectionModal from "@/components/rooms/DeckSelectionModal";
import Battlefield from "@/components/game/Battlefield";

type Props = {
  roomId: string;
  title: string;
  tabId: string;
};

function memberDisplayName(m: RoomMemberWithProfile): string {
  return m.profile?.display_name ?? m.profile?.username ?? "Unknown";
}

function PlayerRow({
  member, isYou, started,
}: {
  member: RoomMemberWithProfile;
  isYou: boolean;
  started: boolean;
}) {
  const name = memberDisplayName(member);
  const isReady = !!member.ready_at;
  const bracket = member.selected_bracket as 2 | 3 | 4 | null;
  const tone = bracket ? BRACKET_TONE[bracket] : null;
  // After the game starts, is_playing is the source of truth. Before start,
  // "playing" isn't meaningful — everyone's still lobbying.
  const isSpectator = started && !member.is_playing;

  return (
    <div
      className={[
        "flex items-center gap-4 px-4 py-3 rounded-lg border transition-colors",
        isSpectator
          ? "bg-bg-surface/50 border-border-subtle opacity-70"
          : isReady
          ? "bg-emerald-500/5 border-emerald-500/40"
          : "bg-bg-surface border-border-subtle",
      ].join(" ")}
    >
      {member.profile?.avatar_url ? (
        <img
          src={member.profile.avatar_url}
          alt=""
          className="h-11 w-11 rounded-full border-2 border-border-strong"
        />
      ) : (
        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center">
          <User size={20} className="text-white" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-semibold text-text-primary truncate">
            {name}
          </span>
          {member.seat === "host" && (
            <Crown size={14} className="text-yellow-400 shrink-0" aria-label="Host" />
          )}
          {isYou && (
            <span className="text-xs text-text-muted shrink-0">(you)</span>
          )}
          {!started && isReady && (
            <CheckCircle2
              size={18}
              className="text-emerald-400 shrink-0"
              aria-label="Ready"
            />
          )}
          {isSpectator && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted border border-border-subtle rounded px-1.5 py-0.5 shrink-0">
              <Eye size={10} /> Spectator
            </span>
          )}
        </div>
        <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
          {isSpectator ? (
            <span className="italic">Not playing this game</span>
          ) : isReady && member.selected_deck ? (
            <span className="truncate">
              Playing <span className="text-text-secondary">{member.selected_deck.name}</span>
            </span>
          ) : member.selected_deck ? (
            <span className="truncate">
              Selected <span className="text-text-secondary">{member.selected_deck.name}</span>
            </span>
          ) : (
            <span className="italic">Choosing a deck…</span>
          )}
        </div>
      </div>

      {(isReady || started) && !isSpectator && bracket && tone && (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border shrink-0 ${tone.bg} ${tone.text} ${tone.border}`}
          title={`Bracket ${bracket} — ${BRACKET_LABELS[bracket as 1 | 2 | 3 | 4 | 5]}`}
        >
          <Zap size={12} /> B{bracket}
        </span>
      )}
    </div>
  );
}

export default function GameRoom({ roomId, tabId }: Props) {
  const { user } = useAuth();
  const { close } = useTabs();
  const { room, members, loading, error, refetch } = useRoom(roomId);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleLeave = async () => {
    if (!user) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveRoom(roomId, user.id);
      close(tabId);
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : "Failed to leave");
      setLeaving(false);
    }
  };

  if (loading && !room) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Loading room…
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-400 mb-3" size={32} />
          <div className="text-text-primary font-medium mb-1">Room unavailable</div>
          <div className="text-sm text-text-muted">
            {error ?? "This room may have been closed by the host or no longer exists."}
          </div>
          <button
            onClick={() => close(tabId)}
            className="mt-4 px-4 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-sm font-medium text-text-primary border border-border-subtle transition-colors"
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  const me = user ? members.find((m) => m.user_id === user.id) ?? null : null;
  const mySelectedDeckId = me?.selected_deck_id ?? null;
  const iAmReady = !!me?.ready_at;
  const iAmHost = !!user && room.host_id === user.id;
  const started = !!room.started_at;

  const handleToggleReady = async () => {
    if (!me || !me.selected_deck_id) return;
    setReadyBusy(true);
    setReadyError(null);
    try {
      await setRoomDeckReady(roomId, me.selected_deck_id, !iAmReady);
      await refetch();
    } catch (e) {
      setReadyError(e instanceof Error ? e.message : "Ready toggle failed");
    } finally {
      setReadyBusy(false);
    }
  };

  const handleStart = async (force: boolean) => {
    setStartBusy(true);
    setStartError(null);
    try {
      await startGame(roomId, force);
      await refetch();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStartBusy(false);
    }
  };

  const readyCount = members.filter((m) => !!m.ready_at).length;
  const deckSelectedCount = members.filter((m) => !!m.selected_deck_id).length;
  const allReady = members.length >= 1 && readyCount === members.length;

  return (
    <div className="h-full flex flex-col bg-bg-base bg-purple-radial">
      {leaveError && (
        <div className="mx-4 mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {leaveError}
        </div>
      )}

      {started ? (
        <div className="flex-1 min-h-0">
          <Battlefield
            members={members}
            viewerId={user?.id}
            onLeave={() => void handleLeave()}
            leaving={leaving}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-xl mx-auto py-10 px-6 flex flex-col gap-8">
            {/* Player stack */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-text-muted text-center">
                Players
              </div>
              {members.map((m) => (
                <PlayerRow
                  key={m.user_id}
                  member={m}
                  isYou={m.user_id === user?.id}
                  started={started}
                />
              ))}
              {Array.from({ length: Math.max(0, room.capacity - members.length) }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg border border-dashed border-border-subtle bg-bg-surface/30"
                >
                  <div className="h-11 w-11 rounded-full border-2 border-dashed border-border-subtle" />
                  <span className="text-sm italic text-text-muted">Waiting for player…</span>
                </div>
              ))}
            </div>

            {/* My controls (deck picker + ready) */}
            {me && (
              <div className="border-t border-border-subtle pt-6 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-text-muted text-center">
                  Your deck
                </div>

                <div className="flex items-center gap-2 justify-center flex-wrap">
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-sm font-medium text-text-primary border border-border-subtle transition-colors"
                  >
                    <Layers size={14} />
                    {me.selected_deck
                      ? `Deck: ${me.selected_deck.name}`
                      : "Choose a deck"}
                  </button>

                  <button
                    onClick={() => void handleToggleReady()}
                    disabled={!mySelectedDeckId || readyBusy}
                    className={[
                      "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold shadow-glow transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                      iAmReady
                        ? "bg-bg-elevated hover:bg-border-subtle text-text-primary border border-border-strong"
                        : "bg-accent hover:bg-accent-hover text-white",
                    ].join(" ")}
                  >
                    {readyBusy && <Loader2 size={14} className="animate-spin" />}
                    {!readyBusy && iAmReady && <CheckCircle2 size={14} />}
                    {iAmReady ? "Unready" : "Ready up"}
                  </button>
                </div>

                {readyError && (
                  <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                    {readyError}
                  </div>
                )}
              </div>
            )}

            {/* Host start controls */}
            {iAmHost && (
              <div className="border-t border-border-subtle pt-6 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-text-muted text-center">
                  Host controls
                </div>
                <div className="flex items-center gap-2 justify-center flex-wrap">
                  {allReady ? (
                    <button
                      onClick={() => void handleStart(false)}
                      disabled={deckSelectedCount < 1 || startBusy}
                      className="flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold shadow-glow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {startBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      Start game
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleStart(true)}
                      disabled={deckSelectedCount < 1 || startBusy}
                      title={
                        deckSelectedCount < 1
                          ? "At least one player needs a selected deck"
                          : `Start with ${deckSelectedCount} of ${members.length} players — others become spectators`
                      }
                      className="flex items-center gap-2 px-4 py-2 rounded-md bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 border border-yellow-500/50 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {startBusy ? <Loader2 size={14} className="animate-spin" /> : <FastForward size={14} />}
                      Force start ({deckSelectedCount}/{members.length})
                    </button>
                  )}
                </div>
                {!allReady && deckSelectedCount > 0 && (
                  <p className="text-xs text-text-muted text-center italic">
                    Force starting will treat players without a selected deck as spectators.
                  </p>
                )}
                {startError && (
                  <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                    {startError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <DeckSelectionModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        roomId={roomId}
        roomMaxBracket={room.max_bracket}
        currentDeckId={mySelectedDeckId}
      />
    </div>
  );
}
