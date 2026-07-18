import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, AlertTriangle, CheckCircle2, Loader2, Layers, SlidersHorizontal, ArrowLeft, Upload,
} from "lucide-react";
import { searchCards, cardImage, type ScryfallCard } from "@/lib/scryfall";
import { useBracketData } from "@/lib/scryfallCache";
import { assessDeck, fingerprintDeck, saveAssessment } from "@/lib/deckAssessment";
import {
  addCardToDeck, pickPrintingForDeck, primaryType, removeCard,
  restoreDeckCard, setCategory, updateCardQuantity, updateDeck, useDeck,
  type DeckCard, type DeckCategory,
} from "@/lib/decks";
import { useTabs } from "@/lib/tabs";
import SearchFilters, {
  EMPTY_FILTERS, buildScryfallQuery, type SearchFiltersState,
} from "@/components/decks/SearchFilters";
import PrintingPickerModal, {
  type PrintingPickerRequest,
} from "@/components/decks/PrintingPickerModal";
import DeckBreakdown from "@/components/decks/DeckBreakdown";
import DeckList from "@/components/decks/DeckList";
import CardImagePreview from "@/components/decks/CardImagePreview";
import QuickAddSearch from "@/components/decks/QuickAddSearch";
import SearchCardModal from "@/components/decks/SearchCardModal";
import DeckBuyButton from "@/components/decks/DeckBuyButton";
import ExportDeckModal from "@/components/decks/ExportDeckModal";

type Props = { deckId: string; tabId: string };

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function DeckEditor({ deckId, tabId }: Props) {
  const { deck, cards, loading, error, refetch } = useDeck(deckId);
  const { close: closeTab, activeTabId } = useTabs();
  const bracketRefs = useBracketData();
  const gameChangerIds = bracketRefs.gameChangers;

  const [name, setName] = useState("");
  const [nameStatus, setNameStatus] = useState<SaveStatus>("idle");
  useEffect(() => {
    if (deck) setName(deck.name);
  }, [deck?.id, deck?.name]);

  // Debounced autosave for name changes.
  const nameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!deck) return;
    if (name === deck.name) {
      setNameStatus("idle");
      return;
    }
    setNameStatus("saving");
    if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    nameSaveTimer.current = setTimeout(async () => {
      try {
        await updateDeck(deck.id, { name: name.trim() || "Untitled deck" });
        setNameStatus("saved");
        // Refetch so the tab title picks up the new name on next render pass.
        await refetch();
      } catch {
        setNameStatus("error");
      }
    }, 800);
    return () => {
      if (nameSaveTimer.current) clearTimeout(nameSaveTimer.current);
    };
  }, [name, deck?.id, deck?.name, refetch]);

  // Auto-save the deck's bracket + total price after the user actually edits.
  // We seed the baseline fingerprint from the first (deck, cards, refs)
  // combination we see and DO NOT save it — otherwise just opening a deck
  // (including a session-restored tab) would bump the assessment timestamp
  // and make it look like MyDecks re-assessed every deck when you refreshed
  // one. Only fingerprint drift from that baseline triggers a save.
  const lastSavedFingerprint = useRef<string | null>(null);
  const assessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!deck) return;
    if (!bracketRefs.gameChangers || !bracketRefs.mld || !bracketRefs.extraTurns) return;
    const fp = fingerprintDeck(cards);

    if (lastSavedFingerprint.current === null) {
      // First observation for this editor session. Adopt as baseline and bail
      // — "the deck as it was when I opened it" is not something we should
      // proactively re-persist.
      lastSavedFingerprint.current = fp;
      return;
    }

    if (fp === lastSavedFingerprint.current) return;

    if (assessTimer.current) clearTimeout(assessTimer.current);
    assessTimer.current = setTimeout(async () => {
      try {
        const assessment = await assessDeck(cards, {
          gameChangers: bracketRefs.gameChangers!,
          mld: bracketRefs.mld!,
          extraTurns: bracketRefs.extraTurns!,
        });
        await saveAssessment(deck.id, assessment);
        lastSavedFingerprint.current = fp;
      } catch {
        /* silent — MyDecks will still have last-known values; user can refresh */
      }
    }, 1500);

    return () => {
      if (assessTimer.current) clearTimeout(assessTimer.current);
    };
  }, [
    cards,
    deck?.id,
    bracketRefs.gameChangers,
    bracketRefs.mld,
    bracketRefs.extraTurns,
  ]);

  // Right panel toggle — starts on the Deck List view.
  const [rightView, setRightView] = useState<"deckList" | "search">("deckList");

  // Debounced Scryfall search. Fires when either the typed query OR any
  // filter changes — composed via buildScryfallQuery.
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFiltersState>(EMPTY_FILTERS);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const composedQuery = useMemo(() => buildScryfallQuery(query, filters), [query, filters]);

  useEffect(() => {
    const q = composedQuery.trim();
    if (!q) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const data = await searchCards(q, controller.signal);
        setResults(data);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setSearchError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [composedQuery]);

  const totalCount = useMemo(
    () => cards.reduce((n, c) => n + c.quantity, 0),
    [cards],
  );

  const [actionError, setActionError] = useState<string | null>(null);

  const withErr = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    }
  };

  // ---- Undo (Ctrl/Cmd+Z) for deleted cards ----
  const UNDO_LIMIT = 50;
  const [undoStack, setUndoStack] = useState<DeckCard[]>([]);

  const handleDeleteWithUndo = (row: DeckCard) => {
    setUndoStack((prev) => {
      const next = [...prev, row];
      return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
    });
    void withErr(() => removeCard(row.id));
  };

  const undoOnce = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setActionError(null);
    try {
      await restoreDeckCard(last);
      await refetch();
      setJustAdded((prev) => ({
        oracleId: last.oracle_id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
      justAddedTimer.current = setTimeout(() => setJustAdded(null), 2500);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Undo failed");
      setUndoStack((prev) => [...prev, last]);
    }
  };

  useEffect(() => {
    if (activeTabId !== tabId) return;
    const onKey = (e: KeyboardEvent) => {
      const isUndo =
        (e.key === "z" || e.key === "Z") &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey;
      if (!isUndo) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (undoStack.length === 0) return;
      e.preventDefault();
      void undoOnce();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTabId, tabId, undoStack]);

  const [justAdded, setJustAdded] = useState<{ oracleId: string; nonce: number } | null>(null);
  const justAddedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
    };
  }, []);

  const handleAddFromResults = async (card: ScryfallCard) => {
    setActionError(null);
    try {
      await addCardToDeck(deckId, card);
      await refetch();
      setJustAdded((prev) => ({
        oracleId: card.oracle_id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
      justAddedTimer.current = setTimeout(() => setJustAdded(null), 2500);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to add card");
    }
  };

  // ---- Preview panel state ----
  // The left rail's image updates on row-hover in the deck list AND on hover
  // over search result cards. When nothing has been hovered yet, we fall back
  // to the commander, then to the first card alphabetically. We keep a
  // minimal { scryfallId, name } shape here so both DeckCard rows and
  // ScryfallCard search results can populate it uniformly.
  type PreviewTarget = { scryfallId: string; name: string };
  const [hoveredCard, setHoveredCard] = useState<PreviewTarget | null>(null);
  const defaultPreview = useMemo<PreviewTarget | null>(() => {
    const commander = cards.find((c) => c.category === "commander");
    if (commander) return { scryfallId: commander.card_scryfall_id, name: commander.name };
    const sorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));
    const first = sorted[0];
    return first ? { scryfallId: first.card_scryfall_id, name: first.name } : null;
  }, [cards]);
  const previewCard = hoveredCard ?? defaultPreview;

  // Click-to-open card details popup for search view.
  const [searchDetailCard, setSearchDetailCard] = useState<ScryfallCard | null>(null);

  // Export deck modal (plain / arena / cockatrice).
  const [exportOpen, setExportOpen] = useState(false);

  // Printing picker state (shared modal for both search + row).
  const [printingRequest, setPrintingRequest] = useState<
    (PrintingPickerRequest & { category: DeckCategory }) | null
  >(null);

  const openPrintingPickerFromSearch = (card: ScryfallCard) => {
    setPrintingRequest({
      oracleId: card.oracle_id,
      name: card.name,
      currentScryfallId: cards.find(
        (c) => c.oracle_id === card.oracle_id && c.category === "main",
      )?.card_scryfall_id,
      category: "main",
    });
  };

  const openPrintingPickerFromRow = (row: DeckCard) => {
    setPrintingRequest({
      oracleId: row.oracle_id,
      name: row.name,
      currentScryfallId: row.card_scryfall_id,
      category: row.category,
    });
  };

  const handlePickPrinting = async (picked: ScryfallCard) => {
    if (!printingRequest) return;
    const category = printingRequest.category;
    setPrintingRequest(null);
    setActionError(null);
    try {
      await pickPrintingForDeck(deckId, picked, { category });
      await refetch();
      setJustAdded((prev) => ({
        oracleId: picked.oracle_id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
      justAddedTimer.current = setTimeout(() => setJustAdded(null), 2500);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update printing");
    }
  };

  if (loading && !deck) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Loading deck…
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-400 mb-3" size={32} />
          <div className="text-text-primary font-medium mb-1">Deck unavailable</div>
          <div className="text-sm text-text-muted">
            {error ?? "This deck may have been deleted."}
          </div>
          <button
            onClick={() => closeTab(tabId)}
            className="mt-4 px-4 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-sm font-medium text-text-primary border border-border-subtle transition-colors"
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "360px 1fr" }}>
      {/* Left: preview panel (deck name + card image) */}
      <aside className="border-r border-border-subtle bg-bg-surface flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-border-subtle">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full bg-transparent text-lg font-modern font-bold tracking-tight text-text-primary focus:outline-none"
          />
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
            <span>Commander · {totalCount} cards</span>
            <span className="ml-auto flex items-center gap-1">
              {nameStatus === "saving" && (<><Loader2 size={11} className="animate-spin" /> Saving…</>)}
              {nameStatus === "saved" && (<><CheckCircle2 size={11} className="text-emerald-400" /> Saved</>)}
              {nameStatus === "error" && (<><AlertTriangle size={11} className="text-red-400" /> Save failed</>)}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border-strong bg-bg-elevated hover:bg-border-subtle text-text-primary text-sm font-medium transition-colors"
              title="Export deck (plain text, Arena, Cockatrice)"
            >
              <Upload size={13} /> Export deck
            </button>
            <DeckBuyButton cards={cards} />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <CardImagePreview
            scryfallId={previewCard?.scryfallId ?? null}
            name={previewCard?.name}
          />
        </div>
      </aside>

      <PrintingPickerModal
        request={printingRequest}
        onClose={() => setPrintingRequest(null)}
        onPick={(picked) => void handlePickPrinting(picked)}
      />

      <SearchCardModal
        card={searchDetailCard}
        onClose={() => setSearchDetailCard(null)}
        onAddToDeck={(c) => void handleAddFromResults(c)}
        onChoosePrinting={(c) => openPrintingPickerFromSearch(c)}
      />

      <ExportDeckModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        deckName={deck.name}
        cards={cards}
      />

      {/* Right: view toggle + (deck list | search) */}
      <section className="min-h-0 flex flex-col">
        <div className="px-6 py-2 border-b border-border-subtle bg-bg-surface/50 flex items-center gap-3">
          {actionError && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1 truncate max-w-xs">
              {actionError}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {rightView === "search" ? (
              <button
                type="button"
                onClick={() => setRightView("deckList")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent hover:bg-accent-hover shadow-glow transition-colors"
                title="Back to deck list"
              >
                <ArrowLeft size={12} /> Back to deck
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRightView("search")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-accent hover:bg-accent-hover shadow-glow transition-colors"
                title="Open advanced search"
              >
                <SlidersHorizontal size={12} /> Advanced search
              </button>
            )}
            <QuickAddSearch
              onQuickAdd={handleAddFromResults}
              onSubmit={(q) => {
                setQuery(q);
                setRightView("search");
              }}
            />
          </div>
        </div>

        {rightView === "deckList" ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-10">
            <DeckList
              cards={cards}
              gameChangerIds={gameChangerIds}
              onHover={(c) => setHoveredCard({ scryfallId: c.card_scryfall_id, name: c.name })}
              onInc={(c) => void withErr(() => updateCardQuantity(c.id, c.quantity + 1))}
              onDec={(c) => {
                // Decrementing to zero is a delete — route it through the undo
                // path so Ctrl/Cmd+Z still restores. Otherwise the DB layer
                // silently calls removeCard and bypasses the undo stack.
                if (c.quantity - 1 <= 0) {
                  handleDeleteWithUndo(c);
                } else {
                  void withErr(() => updateCardQuantity(c.id, c.quantity - 1));
                }
              }}
              onDelete={(c) => handleDeleteWithUndo(c)}
              onRestore={(c) => void withErr(() => restoreDeckCard(c))}
              onToggleCommander={(c) =>
                void withErr(() =>
                  setCategory(c.id, c.category === "commander" ? "main" : "commander"),
                )
              }
              onChangePrinting={(c) => openPrintingPickerFromRow(c)}
              onSetCategory={(c, cat) => void withErr(() => setCategory(c.id, cat))}
              justAdded={justAdded}
            />
            <DeckBreakdown cards={cards} />
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-border-subtle bg-bg-surface/50 space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search cards — Scryfall syntax works here too"
                  className="w-full bg-bg-base border border-border-subtle rounded-md pl-10 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
              </div>

              <SearchFilters
                value={filters}
                onChange={setFilters}
                onReset={() => setFilters(EMPTY_FILTERS)}
              />

              <div className="text-xs text-text-muted h-4">
                {searching && "Searching…"}
                {searchError && <span className="text-red-400">{searchError}</span>}
                {!searching && !searchError && composedQuery && (
                  <span>
                    Showing {results.length} result{results.length === 1 ? "" : "s"} · <span className="font-mono">{composedQuery}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {results.length === 0 && !searching && (
                <div className="h-full flex items-center justify-center text-sm text-text-muted text-center max-w-md mx-auto">
                  {composedQuery ? "No results" : (
                    <div>
                      <p>Type to search, or use the filters above.</p>
                      <p className="mt-2 text-xs">
                        Scryfall syntax also works directly: <span className="font-mono">o:"draw a card"</span>,{" "}
                        <span className="font-mono">is:commander</span>, etc.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
                {results.map((card) => {
                  const img = cardImage(card, "normal");
                  return (
                    <div
                      key={card.id}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() =>
                        setHoveredCard({ scryfallId: card.id, name: card.name })
                      }
                      onClick={() => setSearchDetailCard(card)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSearchDetailCard(card);
                        }
                      }}
                      className="aspect-[5/7] w-full rounded-lg overflow-hidden bg-bg-surface border border-border-subtle hover:border-accent hover:shadow-glow transition-all group relative cursor-pointer focus:outline-none focus:border-accent"
                    >
                      {img ? (
                        <img
                          src={img}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="h-full flex flex-col p-3">
                          <div className="text-sm font-semibold text-text-primary truncate">{card.name}</div>
                          <div className="mt-auto text-xs text-text-muted">{primaryType(card.type_line ?? null)}</div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAddFromResults(card);
                          }}
                          className="w-36 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-glow flex items-center justify-center gap-1 border border-transparent"
                        >
                          <Plus size={12} /> Add to deck
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openPrintingPickerFromSearch(card);
                          }}
                          className="w-36 px-3 py-1.5 rounded-md bg-bg-surface hover:bg-bg-elevated text-text-primary text-xs font-medium border border-border-strong flex items-center justify-center gap-1"
                        >
                          <Layers size={12} /> Choose printing
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
