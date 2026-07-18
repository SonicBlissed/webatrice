import { useState } from "react";
import {
  Crown, Zap, PawPrint, Sparkles, Sparkle, Flag, Wand2, Trophy, Mountain,
  MoreHorizontal, Archive,
  type LucideIcon,
} from "lucide-react";
import {
  groupCardsByType,
  type CardTypeGroup,
  type DeckCard,
  type DeckCategory,
} from "@/lib/decks";
import { ManaSymbols } from "./ManaSymbols";
import RowActionsMenu from "./RowActionsMenu";
import CardDetailModal from "./CardDetailModal";

// One icon per section label. Chosen to be evocative without being cutesy —
// commander gets the crown, creatures get crossed swords (attackers), instants
// get a lightning bolt (fast spells), sorceries a wand (formal cast), etc.
const SECTION_ICON: Record<string, LucideIcon> = {
  Commander: Crown,
  Creature: PawPrint,
  Planeswalker: Sparkles,
  Battle: Flag,
  Instant: Zap,
  Sorcery: Wand2,
  Enchantment: Sparkle,
  Artifact: Trophy,
  Land: Mountain,
  Other: MoreHorizontal,
  Sideboard: Archive,
};

/**
 * Moxfield-style column-grouped deck list. Sections (Commander, then card
 * types) flow into as many columns as the container width allows, each at
 * least ~280px wide. Row hover fires a callback so the left rail preview
 * panel can update.
 */

type Section = { label: string; cards: DeckCard[]; count: number };

type Props = {
  cards: DeckCard[];
  /** oracle_ids of WotC Game Changer cards. `null` means "not loaded yet"; treat as none. */
  gameChangerIds: Set<string> | null;
  onHover: (card: DeckCard) => void;
  onInc: (card: DeckCard) => void;
  onDec: (card: DeckCard) => void;
  onDelete: (card: DeckCard) => void;
  onRestore: (card: DeckCard) => void;
  onToggleCommander: (card: DeckCard) => void;
  onChangePrinting: (card: DeckCard) => void;
  onSetCategory: (card: DeckCard, category: DeckCategory) => void;
  /** oracle_id + nonce of the most recently added card, used to briefly flash its row. */
  justAdded?: { oracleId: string; nonce: number } | null;
};

export default function DeckList({
  cards,
  gameChangerIds,
  onHover,
  onInc,
  onDec,
  onDelete,
  onRestore,
  onToggleCommander,
  onChangePrinting,
  onSetCategory,
  justAdded,
}: Props) {
  const commanders = cards.filter((c) => c.category === "commander");
  const mainCards = cards.filter((c) => c.category === "main");
  const sideboardCards = cards.filter((c) => c.category === "sideboard");
  const grouped = groupCardsByType(mainCards);

  // Click-to-open card details popup. `detailCard` is a snapshot of the row
  // clicked; we keep it around even after the row is deleted so the modal
  // can remain visible with a "removed from deck" state + a Restore button.
  const [detailCard, setDetailCard] = useState<DeckCard | null>(null);
  // Look up the CURRENT row for the clicked card, falling back to oracle_id +
  // category so a restored card (which has a new deck_cards.id) still
  // resolves to the modal's snapshot.
  const liveDetailCard = detailCard
    ? cards.find((c) => c.id === detailCard.id)
      ?? cards.find(
        (c) => c.oracle_id === detailCard.oracle_id && c.category === detailCard.category,
      )
      ?? null
    : null;
  const detailDisplayQuantity = liveDetailCard?.quantity ?? 0;

  const sections: Section[] = [];
  if (commanders.length > 0) {
    sections.push({
      label: "Commander",
      cards: commanders,
      count: commanders.reduce((n, c) => n + c.quantity, 0),
    });
  }
  const typeOrder: CardTypeGroup[] = [
    "Creature",
    "Planeswalker",
    "Battle",
    "Instant",
    "Sorcery",
    "Enchantment",
    "Artifact",
    "Land",
    "Other",
  ];
  for (const type of typeOrder) {
    const list = grouped[type] ?? [];
    if (list.length === 0) continue;
    sections.push({
      label: type,
      cards: list,
      count: list.reduce((n, c) => n + c.quantity, 0),
    });
  }
  if (sideboardCards.length > 0) {
    sections.push({
      label: "Sideboard",
      cards: sideboardCards,
      count: sideboardCards.reduce((n, c) => n + c.quantity, 0),
    });
  }

  if (cards.length === 0) {
    return (
      <div className="text-sm text-text-muted italic px-2 py-6 text-center">
        Empty deck. Switch to <span className="font-medium text-text-primary">Add cards to deck</span> to start adding, or import a list from My Decks.
      </div>
    );
  }

  return (
    <div
      // CSS multi-column masonry: sections flow top-to-bottom filling each
      // ~260px column, then move to the next. `break-inside-avoid` on each
      // section keeps them whole. This is what fixes the "big Creature column
      // leaves acres of gap under Instant" problem.
      style={{ columns: "260px", columnGap: "1.5rem" }}
    >
      {sections.map((section) => {
        const Icon = SECTION_ICON[section.label] ?? MoreHorizontal;
        return (
        <section key={section.label} className="min-w-0 mb-6 break-inside-avoid">
          <h3 className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border-subtle">
            <Icon size={14} className="text-text-secondary shrink-0" />
            <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              {section.label}
            </span>
            <span className="text-sm tabular-nums text-text-muted">
              {section.count}
            </span>
          </h3>
          <ul>
            {section.cards.map((card) => {
              const isGC = gameChangerIds?.has(card.oracle_id) ?? false;
              const isHi = justAdded?.oracleId === card.oracle_id;
              return (
                <li
                  key={`${card.id}-${isHi ? justAdded?.nonce : 0}`}
                  onMouseEnter={() => onHover(card)}
                  className={`group flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-bg-elevated transition-colors ${
                    isHi ? "card-just-added" : ""
                  }`}
                >
                  <span className="text-xs tabular-nums text-text-muted w-5 text-right shrink-0">
                    {card.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDetailCard(card)}
                    className="flex-1 min-w-0 truncate text-left text-sm text-text-primary hover:text-accent transition-colors"
                    title="Click for details"
                  >
                    {card.name}
                  </button>
                  {isGC && (
                    <span
                      className="text-yellow-400 shrink-0"
                      title="Game Changer"
                    >
                      <Zap size={11} />
                    </span>
                  )}
                  <ManaSymbols
                    cost={card.mana_cost ?? ""}
                    size={11}
                    className="shrink-0 opacity-90"
                  />
                  <div className="shrink-0">
                    <RowActionsMenu
                      card={card}
                      onInc={() => onInc(card)}
                      onDec={() => onDec(card)}
                      onDelete={() => onDelete(card)}
                      onToggleCommander={() => onToggleCommander(card)}
                      onChangePrinting={() => onChangePrinting(card)}
                      onSetCategory={(cat) => onSetCategory(card, cat)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        );
      })}

      <CardDetailModal
        card={detailCard}
        displayQuantity={detailDisplayQuantity}
        onClose={() => setDetailCard(null)}
        onInc={() => {
          if (liveDetailCard) onInc(liveDetailCard);
          else if (detailCard) onRestore(detailCard);
        }}
        onDec={() => {
          if (liveDetailCard) onDec(liveDetailCard);
        }}
        onToggleCommander={() => {
          if (liveDetailCard) onToggleCommander(liveDetailCard);
        }}
        onChangePrinting={() => {
          if (liveDetailCard) onChangePrinting(liveDetailCard);
        }}
        onSetCategory={(cat) => {
          if (liveDetailCard) onSetCategory(liveDetailCard, cat);
        }}
      />
    </div>
  );
}
