import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import { Crown, Heart, Skull, Sparkles } from "lucide-react";
import type { RoomMemberWithProfile } from "@/lib/rooms";
import type { DeckCard } from "@/lib/decks";
import { ManaSymbols } from "@/components/decks/ManaSymbols";
import {
  BATTLEFIELD_GAP_PX as BATTLEFIELD_GAP_PX_BASE,
  STACK_OFFSET_PX as STACK_OFFSET_PX_BASE,
  fitBattlefieldGrid,
  slotFraction,
  snapToSlot,
  type BattlefieldGrid,
  type BattlefieldSlot,
} from "@/lib/gameBattlefield";
import { useCardScale } from "@/lib/cardScale";
import {
  CARD_BACK_URL,
  CARD_CORNER_RADIUS,
  CARD_HEIGHT,
  CARD_SIDEWAYS_HEIGHT,
  CARD_SIDEWAYS_WIDTH,
  CARD_WIDTH,
} from "./cardSize";
import ContextMenu from "./ContextMenu";
import LibrarySearchDialog from "./LibrarySearchDialog";
import Card from "./Card";
import { useHoveredCard } from "./hoveredCard";

/**
 * A single instance of a card in the game. Deck rows have a `quantity` field
 * so one row can represent 4 copies; expanding a deck row into `quantity`
 * individual HandCards is how we track each physical card independently.
 */
type HandCard = {
  id: string;
  name: string;
  scryfallId: string;
};

/** A card that has been placed on a battlefield, occupying a specific slot. */
type BattlefieldCard = HandCard & {
  slot: BattlefieldSlot;
  /** Tapped cards render rotated 90° (used, attacking, paying costs). */
  tapped: boolean;
};

/** Which zone a drag was initiated from. Individual card identities are
 *  carried on the DragState itself (`cards[*].id`), so we don't need a
 *  discriminated union here anymore. */
type DragSourceZone =
  | "hand"
  | "battlefield"
  | "library"
  | "graveyard"
  | "exile"
  | "stack"
  | "commandZone";

/**
 * Where a dragged card is being dropped. Battlefield carries the snapped
 * slot; stack carries the insertion index (0 = top of pile, N = bottom);
 * everything else is just the zone.
 */
type DropTarget =
  // Battlefield carries the owner so drops can cross PlayerBoxes — the
  // viewer can gift a card onto an opponent's battlefield.
  | { zone: "battlefield"; slot: BattlefieldSlot; ownerId: string }
  // Hand carries the insertion index so drops can reorder cards within
  // the hand or drop cards into specific positions.
  | { zone: "hand"; index: number }
  | { zone: "library" }
  | { zone: "graveyard" }
  | { zone: "exile" }
  | { zone: "stack"; index: number }
  | { zone: "commandZone" };

/**
 * Live drag state. `cards` holds one entry for a single-card drag or many
 * for a group drag; drop logic iterates over it. `offsetX/Y` capture where
 * the pointer sat within the primary card so the ghost stays anchored and
 * the drop calculation uses the card's top-left, not the pointer position.
 */
type DragState = {
  cards: HandCard[];
  sourceZone: DragSourceZone;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  /** Pointer position where the drag was initiated. Used to distinguish
   *  drags from clicks — a release within a few pixels of the start is
   *  treated as a click and doesn't commit a drop, so double-clicks
   *  don't accidentally re-order stacks. */
  initialX: number;
  initialY: number;
  /** Flips true once the pointer has moved past the threshold. Gates all
   *  visual drag effects (ghost, source-card hiding, cursor override) so
   *  a click that never moves doesn't flash the drag UI. */
  moved: boolean;
};

/** Pointer must move at least this many pixels for a drop to fire. */
const DRAG_MOVEMENT_THRESHOLD_PX = 4;

/** A marquee selection is always within a single zone. */
type Selection = {
  zone: "hand" | "battlefield" | "stack";
  ids: Set<string>;
};

function expandDeckToLibrary(cards: DeckCard[]): HandCard[] {
  const out: HandCard[] = [];
  for (const c of cards) {
    if (c.category === "commander" || c.category === "sideboard") continue;
    for (let i = 0; i < c.quantity; i++) {
      out.push({
        id: `${c.id}-${i}`,
        name: c.name,
        scryfallId: c.card_scryfall_id,
      });
    }
  }
  return out;
}

/** True when the browser is running on macOS — used to pick between
 *  ⌘ (Mac) and Ctrl (Windows/Linux) modifier labels in shortcut hints. */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Max cards allowed in a single battlefield slot. Beyond this, dropped
 *  cards bump to the nearest slot with room. Keeps stacks small enough
 *  for every card's title to remain readable. */
const MAX_STACK_PER_SLOT = 3;

/** How far each successive stack card advances downward, as a fraction of
 *  the card height. 0.35 leaves each card's title fully readable. */
const STACK_VERTICAL_STEP_FRACTION = 0.35;
/** Horizontal zig-zag offset (px). Alternates left/right by index so the
 *  pile visually "shares" the center rather than drifting one direction. */
const STACK_HORIZONTAL_OFFSET_PX = 8;

/**
 * Position each card of the stack within a container of the given size.
 * Index 0 is the top of the pile (resolves next); it renders highest in
 * the container. Cards are centered as a group and squished together if
 * the container can't fit the ideal spacing.
 */
function layoutStack(
  count: number,
  containerW: number,
  containerH: number,
  cardWPx: number = CARD_W_PX_BASE,
  cardHPx: number = CARD_H_PX_BASE,
  hOffsetPx: number = STACK_HORIZONTAL_OFFSET_PX,
): { x: number; y: number }[] {
  if (count === 0) return [];
  const idealStep = cardHPx * STACK_VERTICAL_STEP_FRACTION;
  const maxSpan = Math.max(0, containerH - cardHPx);
  const step =
    count > 1 ? Math.min(idealStep, maxSpan / (count - 1)) : 0;
  const totalSpan = (count - 1) * step;
  const startY = Math.max(0, (containerH - totalSpan - cardHPx) / 2);
  const cx = (containerW - cardWPx) / 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    // Single card sits dead center; zig-zag only applies once there's a
    // second card to share the middle with. Without this, a lone stack
    // card would render shifted 8px left of column center.
    const xOffset =
      count === 1 ? 0 : (i % 2 === 0 ? -1 : 1) * hOffsetPx;
    out.push({ x: cx + xOffset, y: startY + i * step });
  }
  return out;
}

/** Fisher-Yates shuffle. Returns a new array. */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A single player's play-area box. Layout:
 *
 *   +-------+---------+--------------------+
 *   | Info  | CmdZone |                    |
 *   |       |         |    Battlefield     |
 *   |       | Stack   |                    |
 *   |       |         |                    |
 *   +       +---------+--------------------+
 *   |       |            Hand              |   (only for self)
 *   +-------+------------------------------+
 *
 * The info column spans both rows so the hand doesn't cut into it. Non-self
 * boxes skip the hand row entirely — opponents' hands are secret; only the
 * card count is shown in the info column.
 *
 * All zones are placeholders in this iteration — real card data lands with the
 * game-state wiring.
 */

type Props = {
  player: RoomMemberWithProfile;
  isSelf: boolean;
  /** True when it is this player's turn. Drives the accent border/glow
   *  around their box, so the whole table can see whose turn it is. */
  isActive: boolean;
  /** When true, the hand row sits above the play area instead of below.
   *  Used for players in the top row of a multi-row layout so their hand
   *  sits closer to the edge of the screen they're "facing". */
  handOnTop: boolean;
  /** All cards from this player's selected deck. Commanders start in the
   *  command zone; the rest form the library. */
  cards: DeckCard[];
  /** Called when the viewer drops a card onto a different PlayerBox's
   *  battlefield. `intendedSlots` is computed against MY (source) grid; the
   *  receiver runs its own occupancy check + snap on top. Only invoked
   *  from the viewer's PlayerBox. */
  giftCards?: (
    targetPlayerId: string,
    cards: HandCard[],
    intendedSlots: BattlefieldSlot[],
  ) => void;
  /** Called when the viewer's marquee ends, distributing the highlight
   *  set to each PlayerBox by owner id. Pass an empty map to clear all
   *  foreign highlights. Only invoked from the viewer's PlayerBox. */
  broadcastBattlefieldSelection?: (byOwner: Map<string, Set<string>>) => void;
  /** Called by non-self PlayerBoxes on background pointerdown to forward
   *  a marquee-start to the viewer's PlayerBox. Battlefield.tsx wires
   *  this to the viewer's `startMarquee` imperative handle. */
  onMarqueeStart?: (x: number, y: number) => void;
};

/** Where a marquee started — one of the three selectable zones. A single
 *  marquee never bridges zones; for battlefield, the owning player id is
 *  part of the identity so different battlefields count as different
 *  zones. */
type MarqueeStartZone =
  | { zone: "battlefield"; ownerId: string }
  | { zone: "hand" }
  | { zone: "stack" };

/** Imperative handle exposed by every PlayerBox so a sibling box (via
 *  Battlefield's ref map) can push cards into this player's battlefield,
 *  highlight this player's battlefield cards as part of the viewer's
 *  cross-player marquee, or hand off a marquee-start event. */
export type PlayerBoxHandle = {
  receiveBattlefieldCards: (
    cards: HandCard[],
    intendedSlots: BattlefieldSlot[],
  ) => void;
  /** Set the highlighted card ids on THIS player's battlefield. Called
   *  by the viewer's marquee to show what they've selected on foreign
   *  boards. Only affects rendering — these cards remain non-draggable
   *  for anyone but their owner. Pass an empty set to clear. */
  receiveBattlefieldSelection: (ids: Set<string>) => void;
  /** Begin a marquee from the given viewport coordinates. Non-self
   *  PlayerBoxes call this via the Battlefield router so the viewer's
   *  marquee can start over any player's board — including opponents'
   *  battlefields, which the viewer can select-highlight but not drag. */
  startMarquee: (x: number, y: number) => void;
};

const MANA_COLORS: Array<{
  symbol: "W" | "U" | "B" | "R" | "G" | "C";
  label: string;
  tint: string;
}> = [
  { symbol: "W", label: "White",     tint: "#f9f1c8" },
  { symbol: "U", label: "Blue",      tint: "#3b82f6" },
  { symbol: "B", label: "Black",     tint: "#4b5563" },
  { symbol: "R", label: "Red",       tint: "#ef4444" },
  { symbol: "G", label: "Green",     tint: "#10b981" },
  { symbol: "C", label: "Colorless", tint: "#9ca3af" },
];

// Card dims in px, used for the fit calculation. Keep in sync with cardSize
// (5rem × 7rem at the browser's default 16px root font-size).
const CARD_W_PX_BASE = 80;
const CARD_H_PX_BASE = 112;

/**
 * Non-interactive overlay: dashed outline at every snap slot + the divider
 * marking the lands row. Grid is measured by the parent so slot outlines
 * line up exactly with cards rendered in the same layer.
 *
 * When `mirrored`, the vertical layout is flipped so top-row players (as
 * seen from the viewer sitting at the bottom) render "facing" the viewer:
 * their state row 0 sits at the visual bottom, their lands row (max row)
 * sits at the visual top near their hand.
 */
function BattlefieldSlotOverlay({
  grid,
  mirrored,
}: {
  grid: BattlefieldGrid;
  mirrored: boolean;
}) {
  const slots: { row: number; col: number }[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      slots.push({ row, col });
    }
  }
  return (
    <div className="absolute inset-0 pointer-events-none">
      {slots.map((slot) => {
        const { fx, fy } = slotFraction(slot, grid);
        const displayFy = mirrored ? 1 - fy : fy;
        return (
          <div
            key={`${slot.row}-${slot.col}`}
            className="absolute border border-dashed border-border-strong/40"
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              left: `calc((100% - ${CARD_WIDTH}) * ${fx})`,
              // Shrink the usable Y range by 2 × the scaled stack
              // offset so a bottom-row card + its stack doesn't clip
              // past the container. `--card-stack-offset-px` is set by
              // useCardScaleStyle on the game-area root.
              top: `calc((100% - ${CARD_HEIGHT} - 2 * var(--card-stack-offset-px, 15px)) * ${displayFy})`,
              borderRadius: CARD_CORNER_RADIUS,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Full-size zone box matching the Library footprint but WITHOUT the card back
 * image — for zones like Graveyard and Exile where a face-down card isn't the
 * right metaphor. Icon sits as a subtle watermark; count centered on top.
 *
 * Accepts a ref + onPointerDown so it can serve as both a drag source (grab
 * the top card) and a drop target (hit-testing uses the forwarded ref).
 */
const LargeZoneBox = forwardRef<
  HTMLDivElement,
  {
    icon: typeof Heart;
    label: string;
    count: number;
    /** Top card of the pile — its art fills the box so the zone visually
     *  represents what's on top of the physical pile. Null when empty. */
    topCard?: { name: string; scryfallId: string } | null;
    onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  }
>(function LargeZoneBox(
  { icon: Icon, label, count, topCard, onPointerDown },
  ref,
) {
  const draggable = !!onPointerDown;
  const { setHoveredCard } = useHoveredCard();
  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        data-drag-source
        onPointerDown={onPointerDown}
        onMouseEnter={topCard ? () => setHoveredCard(topCard) : undefined}
        className="relative rounded-md border border-border-subtle bg-bg-base/60 overflow-hidden select-none"
        style={{
          width: CARD_SIDEWAYS_WIDTH,
          height: CARD_SIDEWAYS_HEIGHT,
          cursor: draggable ? "grab" : undefined,
          touchAction: draggable ? "none" : undefined,
        }}
        title={
          topCard ? `${label} — ${count} (top: ${topCard.name})` : `${label} — ${count}`
        }
      >
        {topCard && (
          <img
            src={`https://api.scryfall.com/cards/${topCard.scryfallId}?format=image&version=large`}
            alt=""
            draggable={false}
            className="pointer-events-none select-none absolute top-1/2 left-1/2"
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              borderRadius: CARD_CORNER_RADIUS,
              transform: "translate(-50%, -50%) rotate(-90deg)",
            }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-[0.35em] pointer-events-none">
          {!topCard && <Icon size="2.5em" className="text-text-muted shrink-0" />}
          <span
            className="text-white font-modern font-bold tabular-nums text-[3em]"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)" }}
          >
            {count}
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * Face-down sideways card representing a zone stack (library, hand, …).
 * Card back image rotated -90°, with a big count centered on top.
 */
const CardBackZone = forwardRef<
  HTMLDivElement,
  {
    label: string;
    count: number;
    onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  }
>(function CardBackZone({ label, count, onPointerDown }, ref) {
  const draggable = !!onPointerDown;
  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        data-drag-source
        onPointerDown={onPointerDown}
        className="relative rounded-md overflow-hidden border border-border-strong shadow-inner select-none"
        style={{
          width: CARD_SIDEWAYS_WIDTH,
          height: CARD_SIDEWAYS_HEIGHT,
          cursor: draggable ? "grab" : undefined,
          touchAction: draggable ? "none" : undefined,
        }}
        title={`${label} — ${count}`}
      >
        <img
          src={CARD_BACK_URL}
          alt=""
          draggable={false}
          className="pointer-events-none select-none absolute top-1/2 left-1/2"
          style={{
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            // ~7.5% of the card width matches the real MTG corner curve and
            // hides the white JPG background showing through the rounded card
            // corners without eating into meaningful art.
            borderRadius: CARD_CORNER_RADIUS,
            transform: "translate(-50%, -50%) rotate(-90deg)",
          }}
        />
        <div className="absolute inset-0 bg-black/20 pointer-events-none" aria-hidden />
        <div
          className="absolute inset-0 flex items-center justify-center text-white font-modern font-bold tabular-nums text-[3em] pointer-events-none"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)" }}
        >
          {count}
        </div>
      </div>
    </div>
  );
}
);

function ManaPip({
  symbol, label, count, tint,
}: {
  symbol: string;
  label: string;
  count: number;
  tint: string;
}) {
  return (
    <div className="relative" style={{ width: "2.75em", height: "2.75em" }} title={label}>
      <ManaSymbols cost={`{${symbol}}`} size="2.75em" />
      {/* 50% color wash sitting on top of the pip. */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ backgroundColor: tint, opacity: 0.5 }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center text-white font-bold text-[1em] tabular-nums pointer-events-none"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)" }}
      >
        {count}
      </span>
    </div>
  );
}

function PlayerBox(
  {
    player,
    isSelf,
    isActive,
    handOnTop,
    cards,
    giftCards,
    broadcastBattlefieldSelection,
    onMarqueeStart,
  }: Props,
  ref: React.Ref<PlayerBoxHandle>,
) {
  const name = player.profile?.display_name ?? player.profile?.username ?? "Unknown";

  // Scaled versions of the base card-related pixel constants. Every layout
  // computation in this component that measures against card size (grid
  // fit, hit-testing, stack layouts, gaps between cards) uses these so a
  // slider adjustment in the header immediately reshapes the play area.
  // Non-card UI (mana pips, life total, sidebar preview, etc.) is
  // unaffected because it doesn't reference these constants.
  const { scale } = useCardScale();
  const CARD_W_PX = CARD_W_PX_BASE * scale;
  const CARD_H_PX = CARD_H_PX_BASE * scale;
  const BATTLEFIELD_GAP_PX = BATTLEFIELD_GAP_PX_BASE * scale;
  const STACK_OFFSET_PX = STACK_OFFSET_PX_BASE * scale;
  const STACK_HOFFSET_PX = STACK_HORIZONTAL_OFFSET_PX * scale;
  // Reserved room at the visual bottom of the battlefield so a fully
  // stacked bottom-row slot (up to MAX_STACK_PER_SLOT cards, each
  // offset by STACK_OFFSET_PX from the last) doesn't clip past the
  // container edge.
  const stackExtPx = (MAX_STACK_PER_SLOT - 1) * STACK_OFFSET_PX;

  // Commanders start in the command zone. Everything else starts in the
  // library (shuffled once when the deck data arrives).
  const [library, setLibrary] = useState<HandCard[]>([]);
  const [hand, setHand] = useState<HandCard[]>([]);
  const [commandZone, setCommandZone] = useState<HandCard[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const commandZoneRef = useRef<HTMLDivElement>(null);

  // Seed the library and command zone from the deck data exactly once per
  // game — we don't want to reshuffle every time cards state changes.
  useEffect(() => {
    if (libraryReady || cards.length === 0) return;
    setLibrary(shuffled(expandDeckToLibrary(cards)));
    setCommandZone(
      cards
        .filter((c) => c.category === "commander")
        .map((c) => ({
          id: `cmd-${c.id}`,
          name: c.name,
          scryfallId: c.card_scryfall_id,
        })),
    );
    setLibraryReady(true);
  }, [cards, libraryReady]);

  // Preload every image in the viewer's deck the moment we have the deck
  // list, so drawing feels instant instead of waiting on Scryfall. Only for
  // the local player — opponents' hand cards never reveal their face, so
  // burning bandwidth on their images would be wasted.
  useEffect(() => {
    if (!isSelf || cards.length === 0) return;
    for (const c of cards) {
      if (c.category === "sideboard") continue;
      const img = new Image();
      img.src = `https://api.scryfall.com/cards/${c.card_scryfall_id}?format=image&version=large`;
    }
  }, [isSelf, cards]);

  const deckCount = library.length;

  // Refs for measuring the library card and hand zone positions so we can
  // animate a card back travelling between them.
  const libraryRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);

  // In-flight draw animations. Each carries the drawn card + start/end rects.
  // We hide the card identity during flight (always show a back), but track
  // it here so we can add it to `hand` when the flight lands.
  const [flights, setFlights] = useState<
    { id: number; card: HandCard; from: DOMRect; to: DOMRect; landed: boolean }[]
  >([]);

  const DRAW_ANIMATION_MS = 450;

  const mulligan = () => {
    // Put the current hand back into the library, shuffle everything, then
    // draw a fresh 7. Any in-flight draw animations get cancelled so we
    // don't animate stale cards into the reshuffled hand.
    setFlights([]);
    const reshuffled = shuffled([...library, ...hand]);
    setLibrary(reshuffled);
    setHand([]);
    // Defer the draw so the reshuffled library is what `draw` sees.
    setTimeout(() => drawFrom(reshuffled, 7), 0);
  };

  const drawFrom = (source: HandCard[], n: number) => {
    const libEl = libraryRef.current;
    const handEl = handRef.current;
    if (source.length === 0) return;
    const drawable = Math.min(n, source.length);
    const topCards = source.slice(0, drawable);
    setLibrary(source.slice(drawable));

    if (!libEl || !handEl) {
      setHand((h) => [...h, ...topCards]);
      return;
    }
    const from = libEl.getBoundingClientRect();
    const to = handEl.getBoundingClientRect();

    topCards.forEach((card, i) => {
      const id = Date.now() + i;
      setTimeout(() => {
        setFlights((prev) => [...prev, { id, card, from, to, landed: false }]);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setFlights((prev) =>
              prev.map((f) => (f.id === id ? { ...f, landed: true } : f)),
            );
          });
        });
        setTimeout(() => {
          setFlights((prev) => prev.filter((f) => f.id !== id));
          setHand((h) => [...h, card]);
        }, DRAW_ANIMATION_MS);
      }, i * 90);
    });
  };

  const draw = (n: number) => drawFrom(library, n);

  // Ctrl (Windows/Linux) / Cmd (Mac) shortcuts for the viewer's own actions:
  //   +M → mulligan
  //   +D → draw a card (overrides the browser's "bookmark this page")
  //   +S → shuffle library (overrides the browser's "save page")
  // Only bound for the local player — you can't take actions on someone
  // else's zones.
  useEffect(() => {
    if (!isSelf) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        mulligan();
      } else if (key === "d") {
        e.preventDefault();
        draw(1);
      } else if (key === "s") {
        e.preventDefault();
        setLibrary((l) => shuffled(l));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Cards placed on this player's battlefield. Currently local state; will
  // be lifted to shared game state when we wire multiplayer.
  const [battlefield, setBattlefield] = useState<BattlefieldCard[]>([]);

  // Graveyard + exile piles. Each is a stack: the last element is the top.
  // Library uses the opposite convention (index 0 is the top, matching draw
  // semantics of popping from the front).
  const [graveyard, setGraveyard] = useState<HandCard[]>([]);
  const [exile, setExile] = useState<HandCard[]>([]);
  const graveyardRef = useRef<HTMLDivElement>(null);
  const exileRef = useRef<HTMLDivElement>(null);

  // The MTG stack — spells/abilities waiting to resolve. Index 0 is the
  // top (resolves first). Rendered zig-zagged in the middle column so
  // several cards remain individually visible without stealing width from
  // the battlefield.
  const [stack, setStack] = useState<HandCard[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);
  const [stackSize, setStackSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStackSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag state for the local player. Only self can drag — opponents' cards
  // are rendered read-only. Tracking pointer position here lets the portal
  // ghost follow the cursor smoothly.
  const [drag, setDrag] = useState<DragState | null>(null);

  // Marquee selection. Selection is single-zone — the marquee groups whatever
  // it touches by zone and picks the zone contributing the most cards.
  const [selection, setSelection] = useState<Selection | null>(null);
  // Whether the "Search library" dialog is open for this player.
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  // Cards on THIS player's battlefield that the viewer highlighted via a
  // cross-player marquee. Purely visual — these cards still aren't
  // draggable by anyone but their owner.
  const [receivedBattlefieldSelection, setReceivedBattlefieldSelection] =
    useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    startZone: MarqueeStartZone | null;
  } | null>(null);
  // PlayerBox root — used both to bound the marquee-start (only clicks
  // inside this box begin a marquee) and to query card elements when
  // finalizing the selection.
  const boxRef = useRef<HTMLDivElement>(null);

  // The battlefield has TWO refs now that it can scroll horizontally:
  //   - `scrollContainerRef`: the visible/scrollable viewport. Measured
  //     here so we know how many columns naturally fit on-screen.
  //   - `battlefieldRef`: the sized content div holding cards + slot
  //     outlines. Its explicit width grows past the viewport as the grid
  //     extends past the fit, triggering horizontal scroll.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const battlefieldRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setFitSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitGrid = fitBattlefieldGrid(
    fitSize.w,
    fitSize.h,
    CARD_W_PX,
    CARD_H_PX,
  );
  // Infinite battlefield: always leave one empty column to the right of
  // the rightmost card so there's a place to drop new cards. Placing on
  // that buffer extends the grid by one; removing/moving cards away from
  // the edge shrinks it back down to the fit minimum.
  const maxCardCol = battlefield.reduce(
    (max, c) => Math.max(max, c.slot.col),
    -1,
  );
  const grid = {
    cols: Math.max(fitGrid.cols, maxCardCol + 2),
    rows: fitGrid.rows,
  };
  // Content pixel size. Both axes stretch to fill the fit area so cards
  // stay evenly distributed (matching the pre-infinite-battlefield
  // behavior). Once the grid extends past the fit — a buffer column
  // opening beyond the visible width — the natural size takes over and
  // the scroll container starts scrolling.
  const naturalContentW =
    grid.cols * CARD_W_PX + Math.max(0, grid.cols - 1) * BATTLEFIELD_GAP_PX;
  const naturalContentH =
    grid.rows * CARD_H_PX +
    Math.max(0, grid.rows - 1) * BATTLEFIELD_GAP_PX +
    stackExtPx;
  const contentW = Math.max(fitSize.w, naturalContentW);
  const contentH = Math.max(fitSize.h, naturalContentH);

  // Auto-scroll the battlefield to the rightmost column whenever the
  // grid extends. Focuses the user on the freshly-opened buffer column
  // so it's immediately visible for the next drop.
  const prevGridColsRef = useRef(grid.cols);
  useEffect(() => {
    if (grid.cols > prevGridColsRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
      }
    }
    prevGridColsRef.current = grid.cols;
  }, [grid.cols]);

  // Begin a drag on `cards` (single or group) coming from `sourceZone`.
  // Records the pointer's offset from the primary card's top-left so the
  // ghost stays anchored where the user grabbed. No-op for opponents.
  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    cards: HandCard[],
    sourceZone: DragSourceZone,
  ) => {
    if (!isSelf || e.button !== 0 || cards.length === 0) return;
    // preventDefault suppresses the browser's default text-selection AND
    // its native HTML5 drag on any focusable/selectable child (e.g., the
    // card art). Without it the browser sometimes takes over mid-drag and
    // shows the "no drop" cursor, killing our custom drag.
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDrag({
      cards,
      sourceZone,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerX: e.clientX,
      pointerY: e.clientY,
      initialX: e.clientX,
      initialY: e.clientY,
      moved: false,
    });
  };

  // Helpers callsites use at pointerdown time to decide "group drag vs
  // single". If the clicked card is in the current selection and matches
  // the selection's zone, drag the whole group. Otherwise, clear the
  // selection and drag just this one card.
  const startCardDrag = (
    e: React.PointerEvent<HTMLElement>,
    card: HandCard,
    zone: Selection["zone"],
    zoneCards: HandCard[],
  ) => {
    // Opponent card: don't touch selection state — the viewer might have
    // this card highlighted (from a cross-battlefield marquee) and a
    // failed drag attempt shouldn't clear that.
    if (!isSelf) return;
    if (
      selection &&
      selection.zone === zone &&
      selection.ids.has(card.id)
    ) {
      // Card is part of the current selection — start a group drag. A
      // no-move release preserves the group; only actual drag+drop or
      // a click on a non-group card modifies the selection.
      const group = zoneCards.filter((c) => selection.ids.has(c.id));
      beginDrag(e, group, zone);
    } else {
      // Single-card drag. Selection isn't touched yet — the drag
      // pointerup handler decides: if the pointer never moved past the
      // threshold, treat as a click and select just this card. If it
      // moved, treat as a drag and clear selection on drop.
      beginDrag(e, [card], zone);
    }
  };
  const startPileDrag = (
    e: React.PointerEvent<HTMLElement>,
    card: HandCard,
    zone: Exclude<DragSourceZone, "hand" | "battlefield" | "stack">,
  ) => {
    beginDrag(e, [card], zone);
  };

  /** True if this specific card is currently part of an active drag.
   *  Only returns true after the pointer has moved past the threshold —
   *  a click that never becomes a drag doesn't hide its source. */
  const isDragging = (id: string, zone: DragSourceZone) =>
    !!drag &&
    drag.moved &&
    drag.sourceZone === zone &&
    drag.cards.some((c) => c.id === id);

  // Force the grabbing cursor on the whole document while a drag is
  // active. Without this, the OS cursor picks up the style of whatever
  // element is under the pointer — including cursor: not-allowed on
  // disabled phase buttons or other-player zones — which makes the drag
  // look like it's about to fail even though it's fine. Toggling on the
  // "is a drag active" boolean keeps this from thrashing on every pointer
  // move (drag state churns each move to update pointerX/Y).
  const isDragActive = drag !== null && drag.moved;
  useEffect(() => {
    if (!isDragActive) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    const styleEl = document.createElement("style");
    styleEl.textContent = "*, *::before, *::after { cursor: grabbing !important; }";
    document.head.appendChild(styleEl);
    return () => {
      document.body.style.cursor = prev;
      styleEl.remove();
    };
  }, [isDragActive]);

  // Global pointer listeners while dragging. Effect re-registers on every
  // pointer move (drag state churns) — negligible cost, keeps the closure
  // and drop calculation trivially correct.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return null;
        const moved =
          d.moved ||
          Math.abs(e.clientX - d.initialX) > DRAG_MOVEMENT_THRESHOLD_PX ||
          Math.abs(e.clientY - d.initialY) > DRAG_MOVEMENT_THRESHOLD_PX;
        return { ...d, pointerX: e.clientX, pointerY: e.clientY, moved };
      });
    };
    const onUp = (e: PointerEvent) => {
      if (drag.moved) {
        // Real drag: commit drop, clear selection so the group doesn't
        // trail the cards into their new zone.
        const target = detectDropTarget(e.clientX, e.clientY, drag);
        if (target) applyMove(drag.sourceZone, target, drag.cards);
        setSelection(null);
        broadcastBattlefieldSelection?.(new Map());
      } else if (drag.cards.length === 1) {
        // Click, not drag. If it was a single-card drag (i.e., the
        // clicked card wasn't part of an existing group), replace the
        // selection with just that card. Group clicks (cards.length > 1)
        // preserve the group so the user can still drag it afterwards.
        const zone = drag.sourceZone;
        if (zone === "hand" || zone === "battlefield" || zone === "stack") {
          setSelection({
            zone,
            ids: new Set([drag.cards[0].id]),
          });
          broadcastBattlefieldSelection?.(new Map());
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, grid]);

  // Marquee pointer effect. Follows the pointer while dragging out a
  // selection rect; on release, finalize the selection.
  useEffect(() => {
    if (!marquee) return;
    const onMove = (e: PointerEvent) => {
      // Live update the selection as the marquee expands so cards
      // highlight the moment the rect covers them, and un-highlight the
      // moment it doesn't. `pointerup` just closes the marquee — no need
      // to recompute at the end because we already are.
      if (marquee.startZone) {
        const rect = {
          left: Math.min(marquee.x1, e.clientX),
          right: Math.max(marquee.x1, e.clientX),
          top: Math.min(marquee.y1, e.clientY),
          bottom: Math.max(marquee.y1, e.clientY),
        };
        const { own, foreign } = computeMarqueeSelection(
          rect,
          marquee.startZone,
        );
        setSelection(own);
        broadcastBattlefieldSelection?.(foreign);
      }
      setMarquee((m) =>
        m ? { ...m, x2: e.clientX, y2: e.clientY } : null,
      );
    };
    const onUp = () => {
      setMarquee(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [marquee]);

  // Which zone the given viewport point falls in, or null if none. For
  // battlefield, we scan EVERY player's battlefield globally and return
  // the owner id so each board counts as its own zone. Hand/stack are
  // per-player private and only checked against the viewer's own refs.
  const zoneAtPoint = (x: number, y: number): MarqueeStartZone | null => {
    const bfEls = document.querySelectorAll<HTMLElement>(
      "[data-battlefield-owner]",
    );
    for (const el of bfEls) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return {
          zone: "battlefield",
          ownerId: el.dataset.battlefieldOwner ?? "",
        };
      }
    }
    const hit = (el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    if (hit(handRef.current)) return { zone: "hand" };
    if (hit(stackRef.current)) return { zone: "stack" };
    return null;
  };

  // Enumerate card elements intersecting the marquee rect across every
  // zone the marquee could touch, then pick a single zone to select from.
  //
  // Rules:
  //   1. Cards intersecting the rect are grouped by zone. Each
  //      battlefield is a separate zone (keyed by owner).
  //   2. If only one zone has intersecting cards → select those,
  //      regardless of whether that zone matches the start point.
  //   3. If multiple zones have intersecting cards → prefer the start
  //      zone. If the start zone isn't among them, fall back to a fixed
  //      priority (battlefield > hand > stack).
  //
  // This lets a marquee that begins in an empty spot (e.g. stack) still
  // catch cards elsewhere, while preventing accidental mixed selections
  // when the rect straddles two zones that both contain cards.
  const computeMarqueeSelection = (
    rect: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    },
    startZone: MarqueeStartZone,
  ): { own: Selection | null; foreign: Map<string, Set<string>> } => {
    const disjoint = (r: DOMRect) =>
      r.right < rect.left ||
      r.left > rect.right ||
      r.bottom < rect.top ||
      r.top > rect.bottom;

    // key → { ownerId?, ids }. Keys: "hand", "stack", "battlefield:<id>".
    type Bucket = { ownerId?: string; ids: Set<string> };
    const byZone = new Map<string, Bucket>();
    const addHit = (key: string, id: string, ownerId?: string) => {
      const b = byZone.get(key) ?? { ownerId, ids: new Set<string>() };
      b.ids.add(id);
      byZone.set(key, b);
    };

    const boxEl = boxRef.current;
    if (boxEl) {
      (["hand", "stack"] as const).forEach((z) => {
        const els = boxEl.querySelectorAll<HTMLElement>(
          `[data-card][data-zone="${z}"]`,
        );
        els.forEach((el) => {
          const id = el.dataset.cardId;
          if (!id) return;
          if (disjoint(el.getBoundingClientRect())) return;
          addHit(z, id);
        });
      });
    }
    const bfEls = document.querySelectorAll<HTMLElement>(
      "[data-battlefield-owner]",
    );
    bfEls.forEach((bfEl) => {
      const ownerId = bfEl.dataset.battlefieldOwner ?? "";
      const key = `battlefield:${ownerId}`;
      const cardEls = bfEl.querySelectorAll<HTMLElement>(
        `[data-card][data-zone="battlefield"]`,
      );
      cardEls.forEach((el) => {
        const id = el.dataset.cardId;
        if (!id) return;
        if (disjoint(el.getBoundingClientRect())) return;
        addHit(key, id, ownerId);
      });
    });

    if (byZone.size === 0) return { own: null, foreign: new Map() };

    const startKey =
      startZone.zone === "battlefield"
        ? `battlefield:${startZone.ownerId}`
        : startZone.zone;
    const rank = (k: string) => {
      if (k.startsWith("battlefield:")) return 0;
      if (k === "hand") return 1;
      if (k === "stack") return 2;
      return 3;
    };
    let winnerKey: string;
    if (byZone.size === 1) {
      winnerKey = byZone.keys().next().value as string;
    } else if (byZone.has(startKey)) {
      winnerKey = startKey;
    } else {
      winnerKey = [...byZone.keys()].sort((a, b) => rank(a) - rank(b))[0];
    }

    const winner = byZone.get(winnerKey)!;
    if (winnerKey === "hand") {
      return { own: { zone: "hand", ids: winner.ids }, foreign: new Map() };
    }
    if (winnerKey === "stack") {
      return { own: { zone: "stack", ids: winner.ids }, foreign: new Map() };
    }
    // Battlefield: own if we own it, foreign otherwise.
    if (winner.ownerId === player.user_id) {
      return {
        own: { zone: "battlefield", ids: winner.ids },
        foreign: new Map(),
      };
    }
    return {
      own: null,
      foreign: new Map([[winner.ownerId ?? "", winner.ids]]),
    };
  };

  // PlayerBox root pointerdown: start a marquee when the click landed on
  // background (not on any card/pile). Both viewer + opponent boxes handle
  // this — opponent boxes forward to the viewer's PlayerBox via
  // `onMarqueeStart` so a marquee can begin over any battlefield.
  const onPointerDownBox = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Card wrappers, library, graveyard, and exile all have their own
    // pointerdown; let them handle it (they'll manage selection state).
    if (
      target?.closest("[data-card]") ||
      target?.closest("[data-drag-source]")
    ) {
      return;
    }
    // Clicks on a scrollbar (e.g. the hand's horizontal scrollbar) fire
    // pointerdown on the scrolling element with the pointer sitting past
    // clientWidth/clientHeight. Those aren't marquee gestures.
    if (target) {
      const rect = target.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const onHScrollbar =
        target.scrollWidth > target.clientWidth &&
        localY > target.clientHeight;
      const onVScrollbar =
        target.scrollHeight > target.clientHeight &&
        localX > target.clientWidth;
      if (onHScrollbar || onVScrollbar) return;
    }
    if (isSelf) {
      setSelection(null);
      broadcastBattlefieldSelection?.(new Map());
      setMarquee({
        x1: e.clientX,
        y1: e.clientY,
        x2: e.clientX,
        y2: e.clientY,
        startZone: zoneAtPoint(e.clientX, e.clientY),
      });
    } else {
      // Route the marquee-start to the viewer's PlayerBox so it takes
      // over the interaction. `onMarqueeStart` is provided by
      // Battlefield.tsx and looks up the viewer's imperative handle.
      onMarqueeStart?.(e.clientX, e.clientY);
    }
  };

  // Hit-test the pointer against each zone's ref, returning the first
  // match. Battlefield is checked first because it's the biggest area and
  // needs the extra slot-computation step; the others are pure zone hits.
  const detectDropTarget = (
    x: number,
    y: number,
    d: DragState,
  ): DropTarget | null => {
    const insideRect = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
      return r;
    };
    // Battlefield hit-test scans EVERY player's battlefield, not just our
    // own — this is what lets the viewer gift cards onto an opponent's
    // battlefield. For each battlefield, the pointer must be inside the
    // VISIBLE scroll container (content can extend past it when scrolled)
    // and the slot is computed against the content div's rect so scroll
    // offset is naturally accounted for.
    const bfEls = document.querySelectorAll<HTMLElement>(
      "[data-battlefield-owner]",
    );
    for (const el of bfEls) {
      // `el` is the scroll container (visible area). Its first child is
      // the sized content div — use it for coordinate math because it
      // stays aligned with the grid regardless of scroll offset.
      const visibleRect = el.getBoundingClientRect();
      if (
        x < visibleRect.left ||
        x > visibleRect.right ||
        y < visibleRect.top ||
        y > visibleRect.bottom
      ) {
        continue;
      }
      const contentEl = el.firstElementChild as HTMLElement | null;
      if (!contentEl) continue;
      const bfRect = contentEl.getBoundingClientRect();
      const ownerId = el.dataset.battlefieldOwner ?? "";
      const mirrored = el.dataset.battlefieldMirrored === "true";
      const targetGrid = {
        cols: parseInt(el.dataset.gridCols ?? "1", 10) || 1,
        rows: parseInt(el.dataset.gridRows ?? "1", 10) || 1,
      };
      const cardLeft = x - d.offsetX;
      const cardTop = y - d.offsetY;
      const denomX = Math.max(1, bfRect.width - CARD_W_PX);
      // Match the position calc: the last row's base sits `stackExtPx`
      // above the container bottom, so the pointer→slot math must
      // shrink the vertical range by the same amount.
      const denomY = Math.max(1, bfRect.height - CARD_H_PX - stackExtPx);
      const fx = clamp01((cardLeft - bfRect.left) / denomX);
      const rawFy = clamp01((cardTop - bfRect.top) / denomY);
      const fy = mirrored ? 1 - rawFy : rawFy;
      return {
        zone: "battlefield",
        slot: snapToSlot(fx, fy, targetGrid),
        ownerId,
      };
    }
    // Command zone is checked BEFORE stack so that a drop landing at the
    // top of the middle column (where the command zone lives) always goes
    // to the command zone — the commander column is not part of the stack.
    if (insideRect(commandZoneRef.current)) return { zone: "commandZone" };
    const stackRect = insideRect(stackRef.current);
    if (stackRect) {
      // Insertion index is judged against the layout the user actually
      // sees. When dragging cards OUT of the stack, those source cards are
      // hidden and the pile re-flows to `stack.length - drag.cards.length`;
      // matching that count keeps the drop-index visually accurate.
      const layoutCount =
        stack.length - (d.sourceZone === "stack" ? d.cards.length : 0);
      const positions = layoutStack(
        layoutCount,
        stackRect.width,
        stackRect.height,
        CARD_W_PX,
        CARD_H_PX,
        STACK_HOFFSET_PX,
      );
      let idx = 0;
      for (const p of positions) {
        const centerY = stackRect.top + p.y + CARD_H_PX / 2;
        if (y > centerY) idx++;
      }
      return { zone: "stack", index: idx };
    }
    if (insideRect(handRef.current)) {
      // Insertion index = number of hand cards whose center-X sits to the
      // LEFT of the pointer, excluding any cards currently being dragged
      // (they've moved with the cursor and shouldn't influence the index).
      const handEls = boxRef.current?.querySelectorAll<HTMLElement>(
        '[data-card][data-zone="hand"]',
      );
      let idx = 0;
      handEls?.forEach((el) => {
        const id = el.dataset.cardId;
        if (!id) return;
        if (d.sourceZone === "hand" && d.cards.some((c) => c.id === id)) {
          return;
        }
        const r = el.getBoundingClientRect();
        if (x > r.left + r.width / 2) idx++;
      });
      return { zone: "hand", index: idx };
    }
    if (insideRect(libraryRef.current)) return { zone: "library" };
    if (insideRect(graveyardRef.current)) return { zone: "graveyard" };
    if (insideRect(exileRef.current)) return { zone: "exile" };
    return null;
  };

  // Move a group of cards from their source zone to the resolved drop
  // target. Handles both single-card and group drags. Same-zone drops are
  // no-ops except battlefield (re-slot) and stack (reorder).
  const applyMove = (
    sourceZone: DragSourceZone,
    target: DropTarget,
    cards: HandCard[],
  ) => {
    if (cards.length === 0) return;
    const ids = new Set(cards.map((c) => c.id));

    // In-place moves within my own battlefield: re-slot + re-append.
    // (Battlefield dropped on someone else's battlefield falls through
    // to the cross-zone path, which handles the gift + source removal.)
    if (
      target.zone === "battlefield" &&
      sourceZone === "battlefield" &&
      target.ownerId === player.user_id
    ) {
      // Re-slot each dragged card row-major from the drop slot, and
      // re-append them to the end of the array so they land on top of
      // any existing stack at the target slot (paint order = array
      // order, and stack index within a slot = insertion order). If
      // the group came from a single source slot (i.e., a stack), skip
      // row-major and target the drop slot for every card — the
      // resolveSlots cap still bumps overflow to neighbors.
      const intended = intendedBattlefieldSlots(cards, target.slot);
      setBattlefield((b) => {
        const others = b.filter((c) => !ids.has(c.id));
        const slots = resolveSlots(others, intended);
        const moved = cards.map((dc, i) => {
          const orig = b.find((bc) => bc.id === dc.id);
          if (!orig) return null;
          return { ...orig, slot: slots[i] };
        }).filter((c): c is BattlefieldCard => c !== null);
        return [...others, ...moved];
      });
      return;
    }
    if (target.zone === "stack" && sourceZone === "stack") {
      setStack((s) => {
        const others = s.filter((c) => !ids.has(c.id));
        // Preserve source order (already the order in `cards`).
        return [
          ...others.slice(0, target.index),
          ...cards,
          ...others.slice(target.index),
        ];
      });
      return;
    }
    if (target.zone === "hand" && sourceZone === "hand") {
      // Reorder within the hand. `target.index` was computed against the
      // "hand minus dragged cards" positions, so it's already the insert
      // position in the filtered array.
      setHand((h) => {
        const others = h.filter((c) => !ids.has(c.id));
        return [
          ...others.slice(0, target.index),
          ...cards,
          ...others.slice(target.index),
        ];
      });
      return;
    }
    // Same-zone drops for the remaining zones are no-ops.
    if (
      target.zone === sourceZone &&
      target.zone !== "battlefield" &&
      target.zone !== "stack" &&
      target.zone !== "hand"
    ) {
      return;
    }
    // Remove from source.
    if (sourceZone === "hand") {
      setHand((h) => h.filter((c) => !ids.has(c.id)));
    } else if (sourceZone === "battlefield") {
      setBattlefield((b) => b.filter((c) => !ids.has(c.id)));
    } else if (sourceZone === "library") {
      // Filter by ID rather than slice(N): the search-library dialog
      // can drag ANY card out of the library, not just the top. For a
      // top-card drag both approaches remove the same rows.
      setLibrary((l) => l.filter((c) => !ids.has(c.id)));
    } else if (sourceZone === "graveyard") {
      setGraveyard((g) => g.slice(0, g.length - cards.length));
    } else if (sourceZone === "exile") {
      setExile((x) => x.slice(0, x.length - cards.length));
    } else if (sourceZone === "stack") {
      setStack((s) => s.filter((c) => !ids.has(c.id)));
    } else if (sourceZone === "commandZone") {
      setCommandZone((cz) => cz.filter((c) => !ids.has(c.id)));
    }
    // Add to destination. Battlefield: consecutive slots starting from
    // drop slot. Stack: insert as a contiguous block at the index.
    if (target.zone === "battlefield") {
      const intended = intendedBattlefieldSlots(cards, target.slot);
      if (target.ownerId === player.user_id) {
        setBattlefield((b) => {
          const slots = resolveSlots(b, intended);
          return [
            ...b,
            ...cards.map((c, i) => ({
              ...c,
              slot: slots[i],
              tapped: false,
            })),
          ];
        });
      } else {
        // Handing off to another player — Battlefield routes this to the
        // target PlayerBox's imperative handle so the card is added over
        // there. Source removal above already took the card out of our
        // state.
        giftCards?.(target.ownerId, cards, intended);
      }
    } else if (target.zone === "hand") {
      setHand((h) => [
        ...h.slice(0, target.index),
        ...cards,
        ...h.slice(target.index),
      ]);
    } else if (target.zone === "library") {
      setLibrary((l) => [...cards, ...l]);
    } else if (target.zone === "graveyard") {
      setGraveyard((g) => [...g, ...cards]);
    } else if (target.zone === "exile") {
      setExile((x) => [...x, ...cards]);
    } else if (target.zone === "stack") {
      setStack((s) => [
        ...s.slice(0, target.index),
        ...cards,
        ...s.slice(target.index),
      ]);
    } else if (target.zone === "commandZone") {
      setCommandZone((cz) => [...cz, ...cards]);
    }
  };

  // Decide where each card in a battlefield drop wants to land, before
  // the 3-per-slot cap kicks in. When every card in the group came from
  // the battlefield we preserve the source layout:
  //   - single stack (all same source slot) → collapse onto the drop slot
  //   - multiple stacks → translate every card by (source − anchor) so
  //     the whole selection shape lands at the drop point, keeping each
  //     stack intact relative to the others
  // Any mix that includes cards without source slots (hand, library, …)
  // falls back to row-major spreading from the drop slot.
  const intendedBattlefieldSlots = (
    cards: HandCard[],
    start: BattlefieldSlot,
  ): BattlefieldSlot[] => {
    if (cards.length === 0) return [];
    const srcSlots = cards.map(
      (c) => battlefield.find((bc) => bc.id === c.id)?.slot,
    );
    if (srcSlots.every((s) => s !== undefined)) {
      const defined = srcSlots as BattlefieldSlot[];
      const first = defined[0];
      const allSameSlot = defined.every(
        (s) => s.row === first.row && s.col === first.col,
      );
      if (allSameSlot) return cards.map(() => start);
      // Multiple source stacks: use each card's offset from the group's
      // top-left anchor as its offset from the drop slot. Clamp to grid
      // bounds so the shape gets pushed back on-board when the anchor
      // sits close to an edge.
      const minRow = Math.min(...defined.map((s) => s.row));
      const minCol = Math.min(...defined.map((s) => s.col));
      const rows = Math.max(1, grid.rows);
      const cols = Math.max(1, grid.cols);
      return defined.map((s) => ({
        row: Math.max(0, Math.min(rows - 1, start.row + (s.row - minRow))),
        col: Math.max(0, Math.min(cols - 1, start.col + (s.col - minCol))),
      }));
    }
    return slotsFrom(start, cards.length);
  };

  // Row-major slot sequence starting at `start`, wrapping to the next row
  // when we run out of columns. Used for placing group drops on the
  // battlefield so cards spread out visibly instead of overlapping.
  const slotsFrom = (
    start: BattlefieldSlot,
    count: number,
  ): BattlefieldSlot[] => {
    const cols = Math.max(1, grid.cols);
    const rows = Math.max(1, grid.rows);
    const out: BattlefieldSlot[] = [];
    let idx = start.row * cols + start.col;
    for (let i = 0; i < count; i++) {
      const wrapped = idx % (cols * rows);
      out.push({ row: Math.floor(wrapped / cols), col: wrapped % cols });
      idx++;
    }
    return out;
  };

  // Resolve where each card in a drop should actually land, respecting
  // the 3-card-per-slot cap. If the intended slot is full, the card is
  // bumped to the nearest slot (by squared Euclidean distance in row/col
  // space) that still has room. Occupancy accumulates as we place, so a
  // group whose first card fills a slot forces subsequent cards to look
  // elsewhere.
  const resolveSlots = (
    existing: BattlefieldCard[],
    intended: BattlefieldSlot[],
  ): BattlefieldSlot[] => {
    const occ = new Map<string, number>();
    for (const c of existing) {
      const k = `${c.slot.row},${c.slot.col}`;
      occ.set(k, (occ.get(k) ?? 0) + 1);
    }
    const out: BattlefieldSlot[] = [];
    for (const desired of intended) {
      let slot = desired;
      const dk = `${desired.row},${desired.col}`;
      if ((occ.get(dk) ?? 0) >= MAX_STACK_PER_SLOT) {
        slot = findNearestAvailableSlot(desired, occ);
      }
      out.push(slot);
      const k = `${slot.row},${slot.col}`;
      occ.set(k, (occ.get(k) ?? 0) + 1);
    }
    return out;
  };

  // Scan the whole grid, pick the slot with room that's closest to the
  // desired slot in row/col distance. Falls back to the desired slot if
  // the grid is completely full — a pathological case for a battlefield.
  const findNearestAvailableSlot = (
    desired: BattlefieldSlot,
    occ: Map<string, number>,
  ): BattlefieldSlot => {
    let best = desired;
    let bestDist = Infinity;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const k = `${row},${col}`;
        if ((occ.get(k) ?? 0) >= MAX_STACK_PER_SLOT) continue;
        const dRow = row - desired.row;
        const dCol = col - desired.col;
        const dist = dRow * dRow + dCol * dCol;
        if (dist < bestDist) {
          bestDist = dist;
          best = { row, col };
        }
      }
    }
    return best;
  };

  // Expose an imperative "receive" method so a sibling PlayerBox can push
  // gifted cards into this one's battlefield without state-lifting the
  // whole game. resolveSlots enforces this player's 3-per-slot cap, so
  // group gifts land as expected.
  useImperativeHandle(ref, () => ({
    receiveBattlefieldCards: (
      incoming: HandCard[],
      intended: BattlefieldSlot[],
    ) => {
      setBattlefield((b) => {
        const slots = resolveSlots(b, intended);
        return [
          ...b,
          ...incoming.map((c, i) => ({
            ...c,
            slot: slots[i],
            tapped: false,
          })),
        ];
      });
    },
    receiveBattlefieldSelection: (ids: Set<string>) => {
      setReceivedBattlefieldSelection(ids);
    },
    startMarquee: (x: number, y: number) => {
      // Same as the local pointerdown path, but coords come from an
      // opponent's PlayerBox forwarding the interaction to us.
      setSelection(null);
      broadcastBattlefieldSelection?.(new Map());
      setMarquee({
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        startZone: zoneAtPoint(x, y),
      });
    },
  }));

  // Life total — starts at Commander 40. Only mutable by the owning
  // player; opponents render the number read-only. Capped at 9999 so
  // the number can't overflow the display box or (more importantly)
  // push the info column into an obviously silly state.
  const LIFE_MAX = 9999;
  const [life, setLifeState] = useState(40);
  const setLife = (next: number | ((prev: number) => number)) => {
    setLifeState((prev) => {
      const raw = typeof next === "function" ? next(prev) : next;
      return Math.min(LIFE_MAX, Math.trunc(raw));
    });
  };
  const [editingLife, setEditingLife] = useState(false);
  // Placeholder values — real state lands with the game-state iteration.
  const manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  // Displayed counts subtract 1 when a zone is the active drag source so
  // the pile visually loses a card while it hovers under the cursor,
  // without us actually mutating source state until drop commits.
  const displayedDeckCount =
    library.length - (drag?.sourceZone === "library" ? 1 : 0);
  const displayedGraveyardCount =
    graveyard.length - (drag?.sourceZone === "graveyard" ? 1 : 0);
  const displayedExileCount =
    exile.length - (drag?.sourceZone === "exile" ? 1 : 0);

  // Top-of-pile card shown as the zone's visual. If the pile is the active
  // drag source, skip one deeper so the "next" top surfaces while the real
  // top rides under the cursor as the ghost.
  const graveyardTopIdx =
    graveyard.length - 1 - (drag?.sourceZone === "graveyard" ? 1 : 0);
  const exileTopIdx =
    exile.length - 1 - (drag?.sourceZone === "exile" ? 1 : 0);
  const graveyardTop = graveyardTopIdx >= 0 ? graveyard[graveyardTopIdx] : null;
  const exileTop = exileTopIdx >= 0 ? exile[exileTopIdx] : null;

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDownBox}
      className={[
        "h-full min-h-0 rounded-lg border overflow-hidden bg-bg-surface/60 backdrop-blur-sm transition-shadow select-none",
        isActive ? "border-accent" : "border-border-subtle",
      ].join(" ")}
      style={{
        display: "grid",
        // Info column width in em so it scales with the box's font-size.
        // Info col hosts a single-column mana pool on the left + everything
        // else on the right.
        // Middle col holds command zone + stack — sized so that after p-2
        // (0.5rem each side = 1rem total) the inner width equals exactly
        // one card width. Hand row stays in px for now.
        // Info column: contains graveyard/exile which are card-sized
        // (CARD_HEIGHT wide because they're rotated). The `+ 5em` covers
        // the mana-pool sub-column, gap, and padding — non-card UI that
        // stays fixed. So the whole column widens just enough to keep
        // the graveyard from overflowing at higher card scales.
        // Middle column already tracks CARD_WIDTH. Hand row height
        // tracks CARD_HEIGHT + a small non-scaling breathing gap so
        // hand cards don't overflow at bigger scales.
        gridTemplateColumns: `calc(${CARD_HEIGHT} + 5em) calc((${CARD_WIDTH} + 1rem) * 1.2) 1fr`,
        gridTemplateRows: handOnTop
          ? `calc(${CARD_HEIGHT} + 1.5em) 1fr`
          : `1fr calc(${CARD_HEIGHT} + 1.5em)`,
        // Stronger accent glow than shadow-glow when it's this player's turn.
        boxShadow: isActive
          ? "0 0 28px 0 rgb(var(--accent-primary) / 0.5), 0 0 10px 0 rgb(var(--accent-primary) / 0.35)"
          : undefined,
      }}
    >
      {/* Info column — spans both rows. Top: full-width header + life total.
          Bottom: mana-pool sub-column on the left + card zones on the right. */}
      <div
        className="row-span-full border-r border-border-subtle bg-bg-surface/70 flex flex-col p-[0.75em] gap-[0.5em] min-h-0"
        style={{ gridColumn: 1 }}
      >
        {/* Player header — spans full info column width */}
        <div className="flex items-center gap-[0.5em] pb-[0.5em] border-b border-border-subtle">
          <span className="text-[0.875em] font-semibold text-text-primary truncate">
            {name}
          </span>
        </div>

        {/* Life total — spans full info column width; avatar as background
            with a 50% black wash on top. `group` scopes the hover state
            for the +1 / -1 / edit overlay so buttons appear only when the
            viewer mouses over their own life total. */}
        <div
          className="relative flex items-center justify-center gap-[0.75em] rounded-md overflow-hidden py-0 group"
          style={{
            backgroundImage: player.profile?.avatar_url
              ? `url(${player.profile.avatar_url})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {!player.profile?.avatar_url && (
            <div
              className="absolute inset-0 bg-gradient-to-br from-accent-secondary to-accent pointer-events-none"
              aria-hidden
            />
          )}
          <div className="absolute inset-0 bg-black/50 pointer-events-none" aria-hidden />
          <Heart size="2.5em" className="text-red-400 relative z-10" />
          {editingLife && isSelf ? (
            <input
              autoFocus
              type="number"
              value={life}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setLife(Number.isFinite(n) ? n : 0);
              }}
              onBlur={() => setEditingLife(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="relative z-20 w-[3em] bg-transparent text-[3em] font-modern font-bold tabular-nums text-white text-center outline-none"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)" }}
            />
          ) : (
            <span
              className="text-[3em] font-modern font-bold tabular-nums text-white relative z-10"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)" }}
            >
              {life}
            </span>
          )}
          {/* Hover overlay — only the owning player sees the buttons.
              Each L is a real SVG <path> (not a CSS clip-path), so
              pointer events are naturally limited to the filled shape
              — hovering the empty area between the Ls doesn't trigger
              any button. Grey stays a normal rectangular button.
              Vertical vs horizontal gaps use DIFFERENT percentages
              (10% vs 4%) so the pixel gap comes out even on both axes
              given the wide-and-short life container. */}
          {isSelf && !editingLife && (
            <>
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden
                className="absolute inset-0 w-full h-full pointer-events-none z-30"
              >
                <path
                  d="M 0.19 0 L 0.96 0 A 0.04 0.04 0 0 1 1 0.04 L 1 0.96 A 0.04 0.04 0 0 1 0.96 1 L 0.93 1 A 0.04 0.04 0 0 1 0.89 0.96 L 0.89 0.28 A 0.04 0.04 0 0 0 0.85 0.24 L 0.19 0.24 A 0.04 0.04 0 0 1 0.15 0.20 L 0.15 0.04 A 0.04 0.04 0 0 1 0.19 0 Z"
                  onClick={() => setLife((l) => l + 1)}
                  aria-label="+1 life"
                  className="fill-green-500/70 hover:fill-green-500 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-auto cursor-pointer"
                />
                <path
                  d="M 0.04 0 L 0.07 0 A 0.04 0.04 0 0 1 0.11 0.04 L 0.11 0.72 A 0.04 0.04 0 0 0 0.15 0.76 L 0.81 0.76 A 0.04 0.04 0 0 1 0.85 0.80 L 0.85 0.96 A 0.04 0.04 0 0 1 0.81 1 L 0.04 1 A 0.04 0.04 0 0 1 0 0.96 L 0 0.04 A 0.04 0.04 0 0 1 0.04 0 Z"
                  onClick={() => setLife((l) => l - 1)}
                  aria-label="-1 life"
                  className="fill-red-500/70 hover:fill-red-500 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-auto cursor-pointer"
                />
              </svg>
              <button
                type="button"
                onClick={() => setEditingLife(true)}
                aria-label="Edit life total"
                className="absolute bg-gray-600/60 hover:bg-gray-500/80 opacity-0 hover:opacity-100 transition-opacity duration-500 z-30 rounded"
                style={{
                  top: "34%",
                  bottom: "34%",
                  left: "15%",
                  right: "15%",
                }}
              />
            </>
          )}
        </div>

        {/* Below the life total: mana pool (left) + card zones (right) */}
        <div className="flex-1 flex gap-[0.5em] min-h-0">
          {/* Mana pool — single vertical column of pips. Pip sizes are
              fixed; justify-evenly spreads them across the sub-column so
              the spacing scales with the column height. */}
          <div className="shrink-0 flex flex-col justify-evenly items-center">
            {MANA_COLORS.map((m) => (
              <ManaPip
                key={m.symbol}
                symbol={m.symbol}
                label={m.label}
                tint={m.tint}
                count={manaPool[m.symbol]}
              />
            ))}
          </div>

          {/* Card zones — library, graveyard, exile. Zone heights are
              fixed; justify-evenly spreads them across the column so the
              inter-container spacing scales with the column height. */}
          <div className="flex-1 min-w-0 flex flex-col justify-evenly min-h-0">
            <ContextMenu
              items={[
                {
                  label: "Draw a card",
                  onClick: () => draw(1),
                  disabled: deckCount <= 0,
                  shortcut: isMac() ? "⌘D" : "Ctrl+D",
                },
                {
                  label: "Mulligan",
                  onClick: mulligan,
                  disabled: deckCount + hand.length < 7,
                  shortcut: isMac() ? "⌘M" : "Ctrl+M",
                },
                {
                  label: "Shuffle library",
                  onClick: () => setLibrary((l) => shuffled(l)),
                  disabled: deckCount <= 1,
                  shortcut: isMac() ? "⌘S" : "Ctrl+S",
                },
                { divider: true },
                {
                  label: "Search library",
                  onClick: () => setLibrarySearchOpen(true),
                  disabled: deckCount <= 0,
                },
              ]}
            >
              <CardBackZone
                ref={libraryRef}
                label="Library"
                count={displayedDeckCount}
                onPointerDown={
                  isSelf && library.length > 0
                    ? (e) => startPileDrag(e, library[0], "library")
                    : undefined
                }
              />
            </ContextMenu>
            <LargeZoneBox
              ref={graveyardRef}
              icon={Skull}
              label="Graveyard"
              count={displayedGraveyardCount}
              topCard={graveyardTop}
              onPointerDown={
                isSelf && graveyard.length > 0
                  ? (e) =>
                      startPileDrag(
                        e,
                        graveyard[graveyard.length - 1],
                        "graveyard",
                      )
                  : undefined
              }
            />
            <LargeZoneBox
              ref={exileRef}
              icon={Sparkles}
              label="Exile"
              count={displayedExileCount}
              topCard={exileTop}
              onPointerDown={
                isSelf && exile.length > 0
                  ? (e) =>
                      startPileDrag(e, exile[exile.length - 1], "exile")
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* Command zone + Stack column — sits in the play row (opposite the hand).
          The command zone stays anchored at the top of the column for every
          box regardless of mirror, so a commander always sits near "their"
          player. Only the battlefield is mirrored for top-row boxes. */}
      <div
        className="border-r border-border-subtle flex flex-col min-h-0 p-2"
        style={{ gridColumn: 2, gridRow: handOnTop ? 2 : 1 }}
      >
        {/* Command zone. Container sits in the middle column and is both a
            drag source (each card individually draggable) and a drop target
            (send a commander back home from anywhere). The outer wrapper
            spans the FULL column width so any drop landing at the top of
            the middle column resolves to the command zone — otherwise the
            empty space next to the centered card would fall through to
            the stack. Extra size on the inner card wrapper accommodates
            partners without doubling the column width. */}
        <div
          ref={commandZoneRef}
          data-drag-source
          className="shrink-0 flex justify-center"
        >
        <div
          className="relative"
          style={{
            width: `calc(${CARD_WIDTH} + ${Math.max(0, commandZone.length - 1) * 8}px)`,
            height: `calc(${CARD_HEIGHT} + ${Math.max(0, commandZone.length - 1) * 8}px)`,
          }}
        >
          {commandZone.every((c) => isDragging(c.id, "commandZone")) && (
            <div
              className="absolute bg-bg-elevated border border-border-strong shadow-md"
              style={{
                top: 0,
                left: 0,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                borderRadius: CARD_CORNER_RADIUS,
              }}
            />
          )}
          {commandZone.map((c, i) => {
            const dragging = isDragging(c.id, "commandZone");
            return (
              <div
                key={c.id}
                data-card
                data-zone="commandZone"
                data-card-id={c.id}
                onPointerDown={
                  isSelf
                    ? (e) => startPileDrag(e, c, "commandZone")
                    : undefined
                }
                className="absolute"
                style={{
                  top: `${i * 8}px`,
                  left: `${i * 8}px`,
                  zIndex: i,
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  borderRadius: CARD_CORNER_RADIUS,
                  // Gold ring marks these as commanders — distinguishes
                  // them from any other cards that might end up here.
                  boxShadow:
                    "0 0 0 2px #fbbf24, 0 0 10px 2px rgba(251, 191, 36, 0.45)",
                  touchAction: isSelf ? "none" : undefined,
                  cursor: isSelf ? "grab" : "default",
                  opacity: dragging ? 0 : 1,
                }}
              >
                <Card name={c.name} scryfallId={c.scryfallId} />
              </div>
            );
          })}
          {commandZone.some((c) => !isDragging(c.id, "commandZone")) && (
            /* Crown badge hanging off the top-left corner. Hidden while
               the last remaining commander is being dragged so the empty
               command zone looks truly empty during the flight. */
            <Crown
              size={18}
              className="absolute text-amber-300"
              style={{
                top: "-9px",
                left: "-9px",
                zIndex: commandZone.length + 10,
                filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))",
                transform: "rotate(-20deg)",
                fill: "#fbbf24",
                pointerEvents: "none",
              }}
              aria-hidden
            />
          )}
        </div>
        </div>
        {/* Stack — spells/abilities waiting to resolve. Cards zig-zag
            vertically; index 0 renders topmost. Dropping between two
            existing cards inserts at that position. */}
        <div ref={stackRef} className="flex-1 min-h-0 relative">
          {(() => {
            const visible = stack.filter((c) => !isDragging(c.id, "stack"));
            const positions = layoutStack(
              visible.length,
              stackSize.w,
              stackSize.h,
              CARD_W_PX,
              CARD_H_PX,
              STACK_HOFFSET_PX,
            );
            return visible.map((c, i) => {
              const pos = positions[i];
              if (!pos) return null;
              const selected =
                selection?.zone === "stack" && selection.ids.has(c.id);
              return (
                <div
                  key={c.id}
                  data-card
                  data-zone="stack"
                  data-card-id={c.id}
                  onPointerDown={(e) =>
                    startCardDrag(e, c, "stack", stack)
                  }
                  className="absolute hover:z-10"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    touchAction: isSelf ? "none" : undefined,
                    cursor: isSelf ? "grab" : "default",
                    boxShadow: selected
                      ? "0 0 0 2px rgb(59 130 246), 0 0 12px 2px rgb(59 130 246 / 0.6)"
                      : undefined,
                    borderRadius: CARD_CORNER_RADIUS,
                  }}
                >
                  <Card name={c.name} scryfallId={c.scryfallId} />
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Battlefield — sits in the play row (opposite the hand). The inner
          scroll container measures the fit area (how many columns fit
          on-screen). The battlefield content div has an explicit pixel
          size that expands past the fit as cards are placed on the right
          buffer column, triggering horizontal scroll. Padding equals the
          card gap so the visual "frame" around the battlefield matches
          the spacing between cards. */}
      <div
        className="min-h-0 relative"
        style={{ gridColumn: 3, gridRow: handOnTop ? 2 : 1 }}
      >
        {/* Lands divider — spans the full width of the play area,
            ignoring the padding around the scrollable battlefield content
            so it reads as a continuous horizontal line across the box. */}
        {grid.rows >= 2 &&
          (() => {
            const dividerFy = handOnTop
              ? 1 / (2 * (grid.rows - 1))
              : (2 * grid.rows - 3) / (2 * (grid.rows - 1));
            const dividerY =
              BATTLEFIELD_GAP_PX +
              (contentH - CARD_H_PX - stackExtPx) * dividerFy +
              CARD_H_PX / 2;
            return (
              <div
                className="absolute left-0 right-0 border-t border-border-strong/60 pointer-events-none"
                style={{ top: `${dividerY}px` }}
              />
            );
          })()}
        <div
          ref={scrollContainerRef}
          data-battlefield-owner={player.user_id}
          data-battlefield-mirrored={handOnTop ? "true" : "false"}
          data-grid-cols={grid.cols}
          data-grid-rows={grid.rows}
          className="absolute overflow-x-auto overflow-y-hidden"
          style={{
            top: BATTLEFIELD_GAP_PX,
            right: BATTLEFIELD_GAP_PX,
            bottom: BATTLEFIELD_GAP_PX,
            left: BATTLEFIELD_GAP_PX,
          }}
          onWheel={(e) => {
            // Mouse-wheel scrolls the battlefield horizontally. Only
            // when there's actually more content than fits — otherwise
            // let the wheel event bubble to the outer play area.
            const el = e.currentTarget;
            if (el.scrollWidth <= el.clientWidth) return;
            if (e.deltaY === 0) return;
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }}
        >
        <div
          ref={battlefieldRef}
          data-battlefield-content
          className="relative"
          style={{ width: contentW, height: contentH }}
        >
          <BattlefieldSlotOverlay grid={grid} mirrored={handOnTop} />
          {(() => {
            // Group cards by slot so stacked cards get a diagonal offset
            // per position in the pile — later-inserted cards sit further
            // down-right, keeping earlier cards' titles readable.
            const groups = new Map<string, string[]>();
            for (const c of battlefield) {
              const key = `${c.slot.row},${c.slot.col}`;
              const list = groups.get(key) ?? [];
              list.push(c.id);
              groups.set(key, list);
            }
            return battlefield.map((c) => {
              const { fx, fy } = slotFraction(c.slot, grid);
              const displayFy = handOnTop ? 1 - fy : fy;
              const group = groups.get(`${c.slot.row},${c.slot.col}`) ?? [];
              const stackIdx = group.indexOf(c.id);
              const off = stackIdx * STACK_OFFSET_PX;
              const dragging = isDragging(c.id, "battlefield");
              const selected =
                (selection?.zone === "battlefield" && selection.ids.has(c.id)) ||
                receivedBattlefieldSelection.has(c.id);
              return (
                <div
                  key={c.id}
                  data-card
                  data-zone="battlefield"
                  data-card-id={c.id}
                  className="absolute hover:z-10"
                  onPointerDown={(e) =>
                    startCardDrag(
                      e,
                      { id: c.id, name: c.name, scryfallId: c.scryfallId },
                      "battlefield",
                      battlefield.map((bc) => ({
                        id: bc.id,
                        name: bc.name,
                        scryfallId: bc.scryfallId,
                      })),
                    )
                  }
                  onDoubleClick={
                    isSelf
                      ? () => {
                          // If the double-clicked card belongs to the
                          // current marquee selection on THIS battlefield,
                          // tap/untap every selected card together. Local
                          // selection is only ever set for the viewer's
                          // own zones, so this branch never fires for
                          // opponent-battlefield selections — those live
                          // in receivedBattlefieldSelection on the
                          // opponent's PlayerBox and can't be tapped by
                          // the viewer anyway.
                          const groupTap =
                            selection?.zone === "battlefield" &&
                            selection.ids.has(c.id);
                          const targetIds = groupTap
                            ? selection.ids
                            : new Set([c.id]);
                          const nextTapped = !c.tapped;
                          setBattlefield((b) =>
                            b.map((bc) =>
                              targetIds.has(bc.id)
                                ? { ...bc, tapped: nextTapped }
                                : bc,
                            ),
                          );
                        }
                      : undefined
                  }
                  style={{
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    left: `calc((100% - ${CARD_WIDTH}) * ${fx} + ${off}px)`,
                    // Same stack-extension reserve as the slot outlines
                    // so cards and outlines line up perfectly and a
                    // full stack on the bottom row stays on-screen.
                    top: `calc((100% - ${CARD_HEIGHT} - 2 * var(--card-stack-offset-px, 15px)) * ${displayFy} + ${off}px)`,
                    touchAction: isSelf ? "none" : undefined,
                    cursor: isSelf ? "grab" : "default",
                    opacity: dragging ? 0 : 1,
                    boxShadow: selected
                      ? "0 0 0 2px rgb(59 130 246), 0 0 12px 2px rgb(59 130 246 / 0.6)"
                      : undefined,
                    borderRadius: CARD_CORNER_RADIUS,
                    // Tapped cards rotate 90° clockwise in place.
                    // transform-origin: center keeps the pivot at the
                    // card's midpoint so it doesn't drift off its slot.
                    transform: c.tapped ? "rotate(90deg)" : undefined,
                    transformOrigin: "center",
                    transition: "transform 150ms ease-out",
                  }}
                >
                  <Card name={c.name} scryfallId={c.scryfallId} />
                </div>
              );
            });
          })()}
        </div>
        </div>
      </div>

      {/* Hand — every player gets one; row flips based on handOnTop */}
      <div
        ref={handRef}
        className={[
          "bg-bg-surface/40 min-h-0 flex items-center overflow-x-auto",
          handOnTop ? "border-b border-border-subtle" : "border-t border-border-subtle",
        ].join(" ")}
        style={{ gridColumn: "2 / 4", gridRow: handOnTop ? 1 : 2 }}
        onWheel={(e) => {
          // Translate vertical wheel input into horizontal scroll so the
          // mousewheel Just Works over an overflowing hand. Only when
          // there's actual horizontal overflow — otherwise let the event
          // bubble so the outer play-area scrolls normally.
          const el = e.currentTarget;
          if (el.scrollWidth <= el.clientWidth) return;
          if (e.deltaY === 0) return;
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }}
      >
        {/* Static hand — the owner sees the real card faces; everyone else
            sees face-down card backs. `m-auto` on the inner row centers
            the cards when they fit and collapses to 0 when they don't —
            unlike `justify-center`, this leaves the leading edge reachable
            when the hand overflows and needs to scroll. */}
        {hand.length > 0 && (
          <div className="flex items-center gap-1 m-auto px-1">
            {hand.map((c) => {
              const dragging = isDragging(c.id, "hand");
              const selected =
                selection?.zone === "hand" && selection.ids.has(c.id);
              return isSelf ? (
                <div
                  key={c.id}
                  data-card
                  data-zone="hand"
                  data-card-id={c.id}
                  onPointerDown={(e) => startCardDrag(e, c, "hand", hand)}
                  style={{
                    touchAction: "none",
                    cursor: "grab",
                    opacity: dragging ? 0 : 1,
                    boxShadow: selected
                      ? "0 0 0 2px rgb(59 130 246), 0 0 12px 2px rgb(59 130 246 / 0.6)"
                      : undefined,
                    borderRadius: CARD_CORNER_RADIUS,
                  }}
                >
                  <Card name={c.name} scryfallId={c.scryfallId} />
                </div>
              ) : (
                <img
                  key={c.id}
                  src={CARD_BACK_URL}
                  alt=""
                  draggable={false}
                  className="shadow-md pointer-events-none select-none"
                  style={{
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    borderRadius: CARD_CORNER_RADIUS,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* In-flight draw animations — portal-rendered card backs travelling
          from the library rect to the hand rect. */}
      {flights.length > 0 &&
        createPortal(
          <>
            {flights.map((f) => {
              const style: React.CSSProperties = {
                position: "fixed",
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                borderRadius: CARD_CORNER_RADIUS,
                transition: `top ${DRAW_ANIMATION_MS}ms ease-out, left ${DRAW_ANIMATION_MS}ms ease-out, transform ${DRAW_ANIMATION_MS}ms ease-out`,
                pointerEvents: "none",
                zIndex: 200,
              };
              if (!f.landed) {
                // Start: centered on the (sideways) library rect.
                style.left = f.from.left + f.from.width / 2;
                style.top = f.from.top + f.from.height / 2;
                style.transform = "translate(-50%, -50%) rotate(-90deg)";
              } else {
                // Land: centered on the hand rect, no rotation.
                style.left = f.to.left + f.to.width / 2;
                style.top = f.to.top + f.to.height / 2;
                style.transform = "translate(-50%, -50%) rotate(0deg)";
              }
              return (
                <img
                  key={f.id}
                  src={CARD_BACK_URL}
                  alt=""
                  draggable={false}
                  className="shadow-glow"
                  style={style}
                />
              );
            })}
          </>,
          document.body,
        )}

      {/* Marquee selection rectangle. Fixed-position overlay so it can
          straddle scrollable containers without clipping. */}
      {marquee &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
              border: "1px dashed rgb(59 130 246)",
              background: "rgb(59 130 246 / 0.12)",
              pointerEvents: "none",
              zIndex: 275,
            }}
          />,
          document.body,
        )}

      {/* Library search dialog — portals itself to the body, so it can
          render from here without affecting the PlayerBox layout. */}
      <LibrarySearchDialog
        isOpen={librarySearchOpen}
        onClose={() => {
          setLibrarySearchOpen(false);
          // Searching the library exposes its order to the player;
          // shuffle on close so the top of the deck is unknown again.
          setLibrary((l) => shuffled(l));
        }}
        library={library}
        deckCards={cards}
        playerName={name}
        // Pointer-down on a card in the dialog kicks off a normal
        // library-source drag — the card can then be dropped on any
        // zone in the play area (own or opponent battlefield gift).
        onCardPointerDown={
          isSelf
            ? (e, c) => beginDrag(e, [c], "library")
            : undefined
        }
        draggingCardIds={
          drag?.sourceZone === "library"
            ? new Set(drag.cards.map((c) => c.id))
            : undefined
        }
      />

      {/* Drag ghost — a floating copy of the dragged card(s) tracking the
          pointer. Group drags stack the cards with a small diagonal offset
          so the count is visible without hiding the top card. Only shows
          after the pointer crosses the movement threshold, so a click
          without motion never flashes the ghost. */}
      {drag &&
        drag.moved &&
        createPortal(
          <>
            {drag.cards.map((c, i) => (
              <div
                key={c.id}
                style={{
                  position: "fixed",
                  left: drag.pointerX - drag.offsetX + i * 4,
                  top: drag.pointerY - drag.offsetY + i * 4,
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  pointerEvents: "none",
                  // Above the search-library dialog (z-1000) so a card
                  // dragged out of the dialog is visible under the
                  // cursor from the moment the drag starts.
                  zIndex: 1100 + i,
                  transform: "rotate(2deg)",
                  filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.4))",
                }}
              >
                <Card name={c.name} scryfallId={c.scryfallId} />
              </div>
            ))}
          </>,
          document.body,
        )}
    </div>
  );
}

export default forwardRef(PlayerBox);
