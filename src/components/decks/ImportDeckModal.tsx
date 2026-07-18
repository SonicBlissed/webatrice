import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Upload, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { parseDecklist, type ParsedEntry } from "@/lib/decklistParser";
import { fetchCardCollection, type CollectionIdentifier, type ScryfallCard } from "@/lib/scryfall";
import {
  createDeck,
  deckCardFromScryfall,
  deleteDeck,
  insertDeckCards,
  type Deck,
} from "@/lib/decks";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (deck: Deck) => void;
};

type Phase = "input" | "resolving" | "review" | "importing";

type ResolvedRow = {
  entry: ParsedEntry;
  card: ScryfallCard | null; // null = not found on Scryfall
};

const PLACEHOLDER = `Paste your deck list (Arena / MTGO / Moxfield export). Example:

Commander
1 Atraxa, Grand Unifier

Deck
1 Sol Ring
1 Cultivate
1 Swords to Plowshares
...`;

export default function ImportDeckModal({ open, onClose, onImported }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setText("");
    setPhase("input");
    setResolved([]);
    setIgnored([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleResolve = async () => {
    setError(null);
    const { entries, ignored: skippedLines } = parseDecklist(text);
    // Sideboard entries are dropped for Commander decks — no sideboard concept.
    const relevant = entries.filter((e) => e.section !== "sideboard");
    if (relevant.length === 0) {
      setError("No cards recognised. Check the format — one line per card, like `1 Sol Ring`.");
      return;
    }
    setPhase("resolving");
    try {
      // Primary lookup: prefer (set, collector_number) for entries that carry
      // both. That's the most precise identifier — unaffected by unicode/quote
      // issues in card names — and correctly disambiguates Secret Lair /
      // Universes Beyond printings.
      const primaryIdents: CollectionIdentifier[] = relevant.map((entry) =>
        entry.set && entry.collectorNumber
          ? { set: entry.set.toLowerCase(), collector_number: entry.collectorNumber }
          : { name: entry.name },
      );
      const { data: primaryMatched } = await fetchCardCollection(primaryIdents);

      const bySetCollector = new Map<string, ScryfallCard>();
      const byName = new Map<string, ScryfallCard>();
      for (const c of primaryMatched) {
        if (c.set && c.collector_number) {
          bySetCollector.set(`${c.set.toLowerCase()}|${c.collector_number}`, c);
        }
        // Only remember the first sighting of a name — later duplicates would
        // overwrite the printing we actually meant to keep.
        const key = c.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, c);
      }

      const initial: ResolvedRow[] = relevant.map((entry) => {
        let card: ScryfallCard | null = null;
        if (entry.set && entry.collectorNumber) {
          card =
            bySetCollector.get(`${entry.set.toLowerCase()}|${entry.collectorNumber}`) ??
            null;
        } else {
          card = byName.get(entry.name.toLowerCase()) ?? null;
        }
        return { entry, card };
      });

      // Fallback: entries that used (set, collector) but Scryfall didn't know
      // that set code (e.g. `PZA` — a non-standard code some exporters emit)
      // get a second pass by name. We do NOT fall back for name-only entries
      // that missed — that's the terminal "not found" state.
      const needsNameFallback = initial.filter(
        (r) => !r.card && r.entry.set && r.entry.collectorNumber,
      );
      if (needsNameFallback.length > 0) {
        const uniqueFallbackNames = Array.from(
          new Set(needsNameFallback.map((r) => r.entry.name)),
        );
        const { data: fallbackMatched } = await fetchCardCollection(
          uniqueFallbackNames.map((n) => ({ name: n })),
        );
        const fallbackByName = new Map<string, ScryfallCard>();
        for (const c of fallbackMatched) {
          const key = c.name.toLowerCase();
          if (!fallbackByName.has(key)) fallbackByName.set(key, c);
        }
        for (let i = 0; i < initial.length; i++) {
          if (initial[i].card) continue;
          const c = fallbackByName.get(initial[i].entry.name.toLowerCase());
          if (c) initial[i] = { ...initial[i], card: c };
        }
      }

      setResolved(initial);
      setIgnored(skippedLines);
      setPhase("review");
    } catch (e) {
      setPhase("input");
      setError(e instanceof Error ? e.message : "Failed to resolve cards with Scryfall");
    }
  };

  const handleImport = async () => {
    if (!user) return;
    setError(null);
    setPhase("importing");
    const matched = resolved.filter((r) => r.card);
    if (matched.length === 0) {
      setPhase("review");
      setError("Nothing to import — all cards were unmatched.");
      return;
    }

    // Create the deck row, then bulk-insert cards.
    let deck: Deck | null = null;
    try {
      deck = await createDeck(user.id, name.trim() || "Imported deck");
      const rows = matched.map((r) =>
        deckCardFromScryfall(deck!.id, r.card!, {
          quantity: r.entry.quantity,
          category: r.entry.section === "commander" ? "commander" : "main",
        }),
      );
      await insertDeckCards(rows);
      onImported(deck);
    } catch (e) {
      // Roll back on partial failure — we don't want to leave a half-imported deck.
      if (deck) await deleteDeck(deck.id).catch(() => undefined);
      setPhase("review");
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  // Count by total copies, not distinct entries — `4 Lightning Bolt` matching
  // should read as 4, not 1.
  const matchedCount = resolved.reduce(
    (sum, r) => sum + (r.card ? r.entry.quantity : 0),
    0,
  );
  const missingCount = resolved.reduce(
    (sum, r) => sum + (r.card ? 0 : r.entry.quantity),
    0,
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-2xl rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <h2 className="font-modern text-xl font-semibold text-text-primary">Import a deck</h2>
        <p className="text-sm text-text-muted mt-1">
          Paste a list from Moxfield, Arena, MTGO, Cockatrice — most formats work.
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {phase === "input" && (
          <div className="mt-4 flex-1 min-h-0 flex flex-col gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Deck name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="mt-1 w-full bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
            </label>
            <label className="flex-1 min-h-0 flex flex-col">
              <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Decklist
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
                className="mt-1 flex-1 min-h-[240px] bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors resize-none"
              />
            </label>
          </div>
        )}

        {phase === "resolving" && (
          <div className="mt-8 mb-8 flex flex-col items-center gap-2 text-text-secondary text-sm">
            <Loader2 size={20} className="animate-spin text-accent" />
            <div>Looking up cards on Scryfall…</div>
          </div>
        )}

        {phase === "review" && (
          <div className="mt-4 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={14} /> {matchedCount} matched
              </span>
              {missingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-red-300">
                  <AlertTriangle size={14} /> {missingCount} unmatched (dropped on import)
                </span>
              )}
              {ignored.length > 0 && (
                <span className="text-text-muted">· {ignored.length} unrecognised line{ignored.length === 1 ? "" : "s"}</span>
              )}
            </div>

            <div className="mt-3 flex-1 min-h-0 overflow-y-auto border border-border-subtle rounded-md">
              <ul className="divide-y divide-border-subtle">
                {resolved.map((r, i) => (
                  <li key={i} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${r.card ? "" : "bg-red-500/5"}`}>
                    <span className="text-xs tabular-nums text-text-muted w-8 text-right">{r.entry.quantity}×</span>
                    <span className={`flex-1 truncate ${r.card ? "text-text-primary" : "text-red-300"}`}>
                      {r.entry.name}
                    </span>
                    <span className="text-xs uppercase tracking-wider text-text-muted">
                      {r.entry.section}
                    </span>
                    {!r.card && <span className="text-xs text-red-400">not found</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {phase === "importing" && (
          <div className="mt-8 mb-8 flex flex-col items-center gap-2 text-text-secondary text-sm">
            <Loader2 size={20} className="animate-spin text-accent" />
            <div>Creating deck…</div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            Cancel
          </button>
          {phase === "input" && (
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={!text.trim()}
              className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-glow transition-colors flex items-center gap-2"
            >
              Next: check cards
            </button>
          )}
          {phase === "review" && (
            <>
              <button
                type="button"
                onClick={() => setPhase("input")}
                className="px-3 py-2 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={matchedCount === 0}
                className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-glow transition-colors flex items-center gap-2"
              >
                <Upload size={14} /> Import {matchedCount} card{matchedCount === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
