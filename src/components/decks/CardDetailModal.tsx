import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X, Loader2, Minus, Plus, Layers, Crown, Archive, PackageOpen,
} from "lucide-react";
import { cardImage } from "@/lib/scryfall";
import { useScryfallCard } from "@/lib/scryfallCache";
import type { DeckCard, DeckCategory } from "@/lib/decks";
import { ManaSymbols, SymbolText } from "./ManaSymbols";
import CardPrices from "./CardPrices";

/**
 * Click-to-open card details popup. Same data as the hover tooltip but
 * bigger, persistent (dismissed only by the user), and side-by-side layout
 * with the image + text info split. Also carries the same per-card action
 * set as the row's `⌄` menu so users don't have to close the modal to
 * change quantity or move to sideboard.
 */
type Props = {
  /** Snapshot of the card at the time the modal opened. Stays populated even
   *  if the user decrements quantity to zero — the modal keeps showing the
   *  same card and offers a `+` (restore) affordance. */
  card: DeckCard | null;
  /** Current quantity in the deck. Zero means the card has been removed. */
  displayQuantity: number;
  onClose: () => void;
  onInc: () => void;
  onDec: () => void;
  onToggleCommander: () => void;
  onChangePrinting: () => void;
  onSetCategory: (category: DeckCategory) => void;
};

export default function CardDetailModal({
  card, displayQuantity, onClose,
  onInc, onDec, onToggleCommander, onChangePrinting, onSetCategory,
}: Props) {
  const removed = displayQuantity === 0;
  const scryfallId = card?.card_scryfall_id ?? null;
  const { card: full, loading } = useScryfallCard(scryfallId, !!scryfallId);

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  const face = full?.card_faces?.[0];
  const img = full ? cardImage(full, "normal") : null;
  const typeLine = full?.type_line ?? face?.type_line ?? "";
  const oracle = full?.oracle_text ?? face?.oracle_text ?? "";
  const flavor = full?.flavor_text ?? face?.flavor_text ?? "";
  const manaCost = full?.mana_cost ?? face?.mana_cost ?? card.mana_cost ?? "";
  const cmc = typeof full?.cmc === "number" ? full.cmc : card.cmc;
  const setCode = full?.set ?? card.set;
  const collector = full?.collector_number ?? card.collector_number;
  const isCommander = card.category === "commander";
  const isSideboard = card.category === "sideboard";

  // Run an action and immediately close so state changes reflect on the
  // deck list. Quantity +/- is the exception — keep the modal open so the
  // user can adjust rapidly.
  const closeAfter = (fn: () => void) => () => {
    fn();
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

              <div className="flex items-center justify-between px-3 py-2 rounded-md bg-bg-elevated border border-border-subtle">
                <span className="text-sm text-text-secondary">
                  Quantity {removed && <span className="text-xs text-text-muted">· removed from deck</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onDec}
                    disabled={removed}
                    className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center tabular-nums text-text-primary font-semibold">
                    {displayQuantity}
                  </span>
                  <button
                    onClick={onInc}
                    className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-primary"
                    aria-label={removed ? "Restore card" : "Increase quantity"}
                    title={removed ? "Restore card to deck" : "Add one"}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <ActionButton
                icon={<Layers size={14} />}
                label="Change printing"
                disabled={removed}
                onClick={closeAfter(onChangePrinting)}
              />
              <ActionButton
                icon={<Crown size={14} className={isCommander ? "text-yellow-400" : ""} />}
                label={isCommander ? "Unmark as commander" : "Mark as commander"}
                disabled={removed}
                onClick={closeAfter(onToggleCommander)}
              />
              {isSideboard ? (
                <ActionButton
                  icon={<PackageOpen size={14} />}
                  label="Move to main"
                  disabled={removed}
                  onClick={closeAfter(() => onSetCategory("main"))}
                />
              ) : (
                <ActionButton
                  icon={<Archive size={14} />}
                  label="Move to sideboard"
                  disabled={removed}
                  onClick={closeAfter(() => onSetCategory("sideboard"))}
                />
              )}
            </div>

            {full && (
              <div className="mt-1 pt-2 border-t border-border-subtle">
                <CardPrices card={full} />
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

function ActionButton({
  icon, label, onClick, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-left transition-colors bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:border-border-subtle"
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
