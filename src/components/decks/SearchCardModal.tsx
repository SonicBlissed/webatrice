import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Plus, Layers } from "lucide-react";
import { cardImage, type ScryfallCard } from "@/lib/scryfall";
import { useScryfallCard } from "@/lib/scryfallCache";
import { ManaSymbols, SymbolText } from "./ManaSymbols";
import CardPrices from "./CardPrices";

/**
 * Click-to-open card details popup for the search view. Mirrors
 * CardDetailModal's layout, but the actions are search-view specific:
 *   - "Add to deck" adds the default printing (same as the search grid overlay)
 *   - "Choose printing" opens the printing picker
 *
 * Accepts a partial ScryfallCard (whatever `searchCards` returned) as the
 * "seed" and refetches the full card via useScryfallCard so oracle text,
 * flavor text and prices are available even if the search endpoint stripped
 * them out.
 */
type Props = {
  card: ScryfallCard | null;
  onClose: () => void;
  onAddToDeck: (card: ScryfallCard) => void | Promise<void>;
  onChoosePrinting: (card: ScryfallCard) => void;
};

export default function SearchCardModal({
  card, onClose, onAddToDeck, onChoosePrinting,
}: Props) {
  const { card: full, loading } = useScryfallCard(card?.id ?? null, !!card);

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  const display = full ?? card;
  const face = display.card_faces?.[0];
  const img = cardImage(display, "normal");
  const typeLine = display.type_line ?? face?.type_line ?? "";
  const oracle = display.oracle_text ?? face?.oracle_text ?? "";
  const flavor = display.flavor_text ?? face?.flavor_text ?? "";
  const manaCost = display.mana_cost ?? face?.mana_cost ?? "";
  const cmc = typeof display.cmc === "number" ? display.cmc : null;
  const setCode = display.set;
  const collector = display.collector_number;

  const closeAfter = (fn: () => void | Promise<void>) => () => {
    void fn();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-3xl rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="grid gap-6" style={{ gridTemplateColumns: "300px 1fr" }}>
          <div>
            {img ? (
              <img
                src={img}
                alt={card.name}
                className="w-full rounded-lg shadow-glow"
                draggable={false}
              />
            ) : loading ? (
              <div className="w-full aspect-[5/7] rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            ) : (
              <div className="w-full aspect-[5/7] rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center text-xs text-text-muted">
                No image
              </div>
            )}
          </div>

          <div className="min-w-0 flex flex-col gap-3">
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="font-modern text-xl font-bold text-text-primary truncate">
                  {card.name}
                </h2>
                {cmc !== null && (
                  <span className="text-xs text-text-muted tabular-nums shrink-0">
                    CMC {cmc}
                  </span>
                )}
              </div>
              {manaCost && (
                <div className="mt-1">
                  <ManaSymbols cost={manaCost} size={16} />
                </div>
              )}
            </div>

            {typeLine && (
              <div className="text-sm text-text-secondary italic">{typeLine}</div>
            )}

            {oracle && (
              <div className="text-sm text-text-primary whitespace-pre-line leading-relaxed">
                <SymbolText text={oracle} size={13} />
              </div>
            )}

            {flavor && (
              <div className="text-sm text-text-muted italic whitespace-pre-line leading-relaxed border-t border-border-subtle pt-3">
                <SymbolText text={flavor} size={13} />
              </div>
            )}

            {/* Actions */}
            <div className="mt-2 border-t border-border-subtle pt-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                Actions
              </div>
              <button
                type="button"
                onClick={closeAfter(() => onAddToDeck(display))}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-semibold shadow-glow transition-colors"
              >
                <Plus size={14} /> Add to deck
              </button>
              <button
                type="button"
                onClick={closeAfter(() => onChoosePrinting(display))}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-text-primary text-sm font-medium border border-border-strong transition-colors"
              >
                <Layers size={14} /> Choose printing
              </button>
            </div>

            {display && (
              <div className="mt-1 pt-2 border-t border-border-subtle">
                <CardPrices card={display} />
              </div>
            )}

            {(setCode || collector) && (
              <div className="text-xs text-text-muted mt-1 pt-2 border-t border-border-subtle uppercase tracking-wider">
                {setCode?.toUpperCase() ?? "?"} · #{collector ?? "?"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
