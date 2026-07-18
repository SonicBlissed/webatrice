import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Loader2, AlertTriangle, CheckCircle2, Zap, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyDecks, type Deck } from "@/lib/decks";
import { useBracketData } from "@/lib/scryfallCache";
import { refreshDeckAssessment } from "@/lib/deckAssessment";
import { setRoomDeckReady, type Bracket } from "@/lib/rooms";

type Props = {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomMaxBracket: Bracket;
  /** ID of the deck currently selected for this room, if any. Highlights it. */
  currentDeckId: string | null;
};

/**
 * "Pick a deck for this room" modal. Lists the user's decks and disables any
 * whose bracket exceeds the room's ceiling. Unassessed decks are shown but
 * dimmed with an inline "Assess" button that recomputes their bracket.
 *
 * Selecting a deck immediately writes to the DB (deck-selected, not-yet-ready).
 * The Ready toggle lives on the GameRoom itself so the modal doesn't have to
 * hang around after picking.
 */
export default function DeckSelectionModal({
  open, onClose, roomId, roomMaxBracket, currentDeckId,
}: Props) {
  const { user } = useAuth();
  const { decks, loading: decksLoading, refetch: refetchDecks } = useMyDecks(user?.id);
  const bracketRefs = useBracketData();

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const canRefresh =
    !!bracketRefs.gameChangers && !!bracketRefs.mld && !!bracketRefs.extraTurns;

  const handleRefreshOne = async (deckId: string) => {
    if (!canRefresh) return;
    setRefreshingId(deckId);
    setError(null);
    try {
      await refreshDeckAssessment(deckId, {
        gameChangers: bracketRefs.gameChangers!,
        mld: bracketRefs.mld!,
        extraTurns: bracketRefs.extraTurns!,
      });
      await refetchDecks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assess deck");
    } finally {
      setRefreshingId(null);
    }
  };

  const handlePick = async (deck: Deck) => {
    setSelectingId(deck.id);
    setError(null);
    try {
      // Preserve ready state: if they're re-picking the same deck they were
      // already on, that's a no-op the RPC handles gracefully (deck unchanged
      // → trigger doesn't clear ready). Otherwise the trigger unreadies.
      await setRoomDeckReady(roomId, deck.id, false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select deck");
    } finally {
      setSelectingId(null);
    }
  };

  const sortedDecks = useMemo(() => {
    // Assessed + within cap first, then over-cap, then unassessed.
    const pri = (d: Deck) => {
      if (d.bracket == null) return 2;
      if (d.bracket > roomMaxBracket) return 1;
      return 0;
    };
    return [...decks].sort((a, b) => {
      const pa = pri(a);
      const pb = pri(b);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }, [decks, roomMaxBracket]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-2xl rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="mb-4">
          <h2 className="font-modern text-xl font-bold text-text-primary">Choose your deck</h2>
          <p className="text-xs text-text-muted mt-1">
            Room max: <span className="text-text-primary font-medium">B{roomMaxBracket}</span> — decks above this bracket can't be selected.
          </p>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
          {decksLoading && decks.length === 0 && (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              <Loader2 size={16} className="animate-spin mr-2 text-accent" /> Loading your decks…
            </div>
          )}

          {!decksLoading && decks.length === 0 && (
            <div className="py-12 text-center text-sm text-text-muted">
              You don't have any decks yet. Head to the <span className="text-text-primary font-medium">My Decks</span> tab to create one.
            </div>
          )}

          <ul className="space-y-2">
            {sortedDecks.map((deck) => {
              const bracket = deck.bracket as 2 | 3 | 4 | null;
              const overCap = bracket !== null && bracket > roomMaxBracket;
              const unassessed = bracket === null;
              const disabled = overCap || unassessed;
              const isSelecting = selectingId === deck.id;
              const isRefreshingThis = refreshingId === deck.id;
              const isCurrent = deck.id === currentDeckId;

              return (
                <li
                  key={deck.id}
                  className={[
                    "rounded-lg border p-3 flex items-center gap-3 transition-colors",
                    isCurrent
                      ? "bg-accent/10 border-accent/60"
                      : disabled
                      ? "bg-bg-base/30 border-border-subtle/50 opacity-60"
                      : "bg-bg-elevated border-border-subtle hover:border-accent",
                  ].join(" ")}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`font-medium truncate ${
                          disabled ? "text-text-muted" : "text-text-primary"
                        }`}
                      >
                        {deck.name}
                      </div>
                      {bracket !== null && (
                        <span
                          className={[
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border",
                            overCap
                              ? "bg-red-500/15 text-red-300 border-red-500/40"
                              : bracket === 2
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                              : bracket === 3
                              ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/40"
                              : "bg-red-500/15 text-red-300 border-red-500/40",
                          ].join(" ")}
                        >
                          <Zap size={10} /> B{bracket}
                        </span>
                      )}
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-accent font-semibold">
                          <CheckCircle2 size={11} /> Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {overCap && (
                        <span className="text-red-300">
                          Over the room's B{roomMaxBracket} ceiling
                        </span>
                      )}
                      {unassessed && <span className="italic">Not yet assessed</span>}
                      {!overCap && !unassessed && (
                        <span>Ready to play</span>
                      )}
                    </div>
                  </div>

                  {unassessed ? (
                    <button
                      onClick={() => void handleRefreshOne(deck.id)}
                      disabled={!canRefresh || isRefreshingThis}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-surface border border-border-strong text-text-primary hover:bg-bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={12} className={isRefreshingThis ? "animate-spin" : ""} />
                      {isRefreshingThis ? "Assessing…" : "Assess first"}
                    </button>
                  ) : (
                    <button
                      onClick={() => void handlePick(deck)}
                      disabled={disabled || isSelecting}
                      className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent hover:bg-accent-hover text-white shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSelecting ? "Selecting…" : isCurrent ? "Keep" : "Select"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
