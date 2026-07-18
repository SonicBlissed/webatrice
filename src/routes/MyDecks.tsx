import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, FileText, Upload, AlertTriangle, Zap, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTabs } from "@/lib/tabs";
import { createDeck, deleteDeck, useMyDecks, type Deck } from "@/lib/decks";
import { supabase } from "@/lib/supabase";
import { formatElapsed, useNow } from "@/lib/time";
import { useBracketData } from "@/lib/scryfallCache";
import { refreshDeckAssessment, type AssessmentBracket } from "@/lib/deckAssessment";
import ImportDeckModal from "@/components/decks/ImportDeckModal";

/**
 * Scryfall's image endpoint for the art crop of a specific printing. Returns
 * a landscape crop with none of the frame — perfect as a row background.
 * Redirects to a CDN URL, cached aggressively by the browser.
 */
function commanderArtUrl(scryfallId: string): string {
  return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=art_crop`;
}

const BRACKET_TONE: Record<AssessmentBracket, { text: string; bg: string; border: string }> = {
  2: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  3: { text: "text-yellow-300",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40"  },
  4: { text: "text-red-300",     bg: "bg-red-500/15",     border: "border-red-500/40"     },
};

const BRACKET_LABEL: Record<AssessmentBracket, string> = {
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
};

function BracketBadge({ bracket }: { bracket: AssessmentBracket }) {
  const tone = BRACKET_TONE[bracket];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
      title={`Bracket ${bracket} — ${BRACKET_LABEL[bracket]}`}
    >
      <Zap size={12} /> B{bracket}
    </span>
  );
}

export default function MyDecks() {
  const { user } = useAuth();
  const { openOrFocus } = useTabs();
  const { decks, loading, error, refetch } = useMyDecks(user?.id);
  const bracketRefs = useBracketData();
  const now = useNow(60_000);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Commander per deck, for the row background art. One batched query rather
  // than N per-row lookups. Refires when the deck-id set changes.
  const deckIdsKey = useMemo(() => decks.map((d) => d.id).sort().join("|"), [decks]);
  const [commanders, setCommanders] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (decks.length === 0) {
      setCommanders(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("deck_cards")
        .select("deck_id, card_scryfall_id")
        .in("deck_id", decks.map((d) => d.id))
        .eq("category", "commander");
      if (cancelled || error) return;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as { deck_id: string; card_scryfall_id: string }[]) {
        // Partner commanders: two rows per deck. First one wins for the art.
        if (!map.has(row.deck_id)) map.set(row.deck_id, row.card_scryfall_id);
      }
      setCommanders(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckIdsKey]);

  const openDeckTab = (deck: Deck) => {
    openOrFocus({
      id: `deck-${deck.id}`,
      type: "deck",
      title: deck.name,
      data: { deckId: deck.id },
    });
  };

  const handleNewDeck = async () => {
    if (!user) return;
    setBusy(true);
    setActionError(null);
    try {
      const deck = await createDeck(user.id);
      await refetch();
      openDeckTab(deck);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create deck");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (deckId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteDeck(deckId);
      setConfirmingDelete(null);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete deck");
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async (deckId: string) => {
    if (!bracketRefs.gameChangers || !bracketRefs.mld || !bracketRefs.extraTurns) return;
    setRefreshingId(deckId);
    setActionError(null);
    try {
      await refreshDeckAssessment(deckId, {
        gameChangers: bracketRefs.gameChangers,
        mld: bracketRefs.mld,
        extraTurns: bracketRefs.extraTurns,
      });
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-modern text-2xl font-semibold tracking-tight text-text-primary">
              My Decks
            </h1>
            <p className="text-sm text-text-muted">
              {loading ? "Loading…" : `${decks.length} deck${decks.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-sm font-medium text-text-primary border border-border-subtle transition-colors"
            >
              <Upload size={14} /> Import
            </button>
            <button
              onClick={() => void handleNewDeck()}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-sm font-semibold text-white shadow-glow disabled:opacity-60 transition-colors"
            >
              <Plus size={14} /> New deck
            </button>
          </div>
        </div>

        {(error || actionError) && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error ?? actionError}</span>
          </div>
        )}

        {!loading && decks.length === 0 && (
          <div className="text-center py-16 rounded-lg bg-bg-surface border border-border-subtle">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-bg-elevated border border-border-subtle mb-3">
              <FileText size={20} className="text-accent" />
            </div>
            <div className="text-text-primary font-medium">No decks yet</div>
            <div className="text-sm text-text-muted mt-1">
              Start with a blank deck, or import a list from Arena / Moxfield.
            </div>
          </div>
        )}

        <div className="space-y-2">
          {decks.map((deck) => {
            const bracket = deck.bracket as AssessmentBracket | null;
            const price = deck.total_price_usd;
            const missing = deck.total_price_missing_count ?? 0;
            const isRefreshing = refreshingId === deck.id;
            const canRefresh =
              !!bracketRefs.gameChangers && !!bracketRefs.mld && !!bracketRefs.extraTurns;
            const commanderId = commanders.get(deck.id);
            return (
              <div
                key={deck.id}
                className="group relative rounded-lg bg-bg-surface border border-border-subtle hover:border-border-strong overflow-hidden transition-all"
              >
                {commanderId && (
                  <>
                    <div
                      className="absolute inset-y-0 right-0 w-1/2 pointer-events-none opacity-90 group-hover:opacity-100 transition-opacity"
                      style={{
                        backgroundImage: `url(${commanderArtUrl(commanderId)})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center 30%",
                      }}
                      aria-hidden
                    />
                    <div
                      className="absolute inset-y-0 right-0 w-1/2 pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(115deg, rgb(var(--bg-surface)) 15%, rgb(var(--bg-surface) / 0.35) 40%, rgb(var(--bg-surface) / 0) 70%)",
                      }}
                      aria-hidden
                    />
                  </>
                )}
                <button
                  onClick={() => openDeckTab(deck)}
                  className="relative w-full text-left flex items-center gap-4 p-4 min-h-36"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-xl font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
                        {deck.name}
                      </div>
                      {bracket === 2 || bracket === 3 || bracket === 4 ? (
                        <BracketBadge bracket={bracket} />
                      ) : null}
                    </div>
                    <div className="text-sm text-text-muted mt-2 flex items-center gap-2 flex-wrap">
                      <span>edited {formatElapsed(deck.updated_at, now)}</span>
                      {price !== null && (
                        <>
                          <span>·</span>
                          <span
                            className="tabular-nums text-emerald-300 font-medium"
                            title={
                              missing > 0
                                ? `Price missing for ${missing} card${missing === 1 ? "" : "s"}`
                                : "Total TCGplayer USD (as of last assessment)"
                            }
                          >
                            ${Number(price).toFixed(2)}
                            {missing > 0 && (
                              <span className="text-text-muted font-normal">*</span>
                            )}
                          </span>
                        </>
                      )}
                      {deck.bracket_assessed_at && (() => {
                        const elapsed = formatElapsed(deck.bracket_assessed_at, now);
                        return (
                          <>
                            <span>·</span>
                            <span title={new Date(deck.bracket_assessed_at).toLocaleString()}>
                              assessed {elapsed}{elapsed === "just now" ? "" : " ago"}
                            </span>
                          </>
                        );
                      })()}
                      {!deck.bracket_assessed_at && (
                        <>
                          <span>·</span>
                          <span className="italic">not yet assessed</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                {/* Floating action buttons — sit above the art on the right */}
                <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
                  <button
                    onClick={() => void handleRefresh(deck.id)}
                    disabled={!canRefresh || isRefreshing || busy}
                    title={
                      !canRefresh
                        ? "Loading bracket reference data…"
                        : "Refresh bracket + price from live data"
                    }
                    className="p-2 rounded-md bg-bg-surface/80 backdrop-blur-sm border border-border-subtle text-text-muted hover:text-accent hover:bg-bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                  </button>
                  {confirmingDelete === deck.id ? (
                    <div className="flex items-center gap-1 bg-bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-md px-1.5 py-1">
                      <span className="text-xs text-text-muted px-1">Delete?</span>
                      <button
                        onClick={() => void handleDelete(deck.id)}
                        disabled={busy}
                        className="px-2 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 text-xs font-medium transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="px-2 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-base transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(deck.id)}
                      className="p-2 rounded-md bg-bg-surface/80 backdrop-blur-sm border border-border-subtle text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete deck"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ImportDeckModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={(deck) => {
          setShowImport(false);
          void refetch();
          openDeckTab(deck);
        }}
      />
    </div>
  );
}
