import type { Zone } from "./gameZones";
import type { BattlefieldSlot } from "./gameBattlefield";

/**
 * A single card instance during a game. Not the same as a `DeckCard` row —
 * a DeckCard represents "1 copy of Sol Ring in this deck at quantity 3",
 * whereas a GameCard is one individual physical card on the table.
 *
 * When a card is on the battlefield:
 *   - `zone` is "battlefield"
 *   - `battlefieldOwnerId` names whose battlefield it sits on (which can
 *      differ from `controllerId` and `ownerId`)
 *   - `slot` names the grid cell
 * For every other zone, `battlefieldOwnerId` and `slot` are undefined.
 */
export type GameCard = {
  /** Unique per game instance. Generated at game start. */
  id: string;

  /** The player who owns the card — brought it in their deck. Determines
   *  which library / graveyard / hand / exile it returns to. */
  ownerId: string;

  /** The player who currently controls the card. Usually equals ownerId;
   *  differs after steal effects (Threaten, Mind Control, …). */
  controllerId: string;

  /** Exact Scryfall printing so art matches the deck's chosen printing. */
  scryfallId: string;

  /** Card name — cached so we don't need to hit Scryfall for every lookup. */
  name: string;

  zone: Zone;

  /** Whose battlefield this card sits on. Only set when zone === "battlefield". */
  battlefieldOwnerId?: string;

  /** Grid slot on that battlefield. Only set when zone === "battlefield". */
  slot?: BattlefieldSlot;

  /** Tapped state — only meaningful on the battlefield. */
  tapped: boolean;

  /** Face-down (Ixidor / Ixalan-flip / cascade morph, etc.). */
  faceDown: boolean;
};

/**
 * Move a card to another player's (or the same player's) battlefield at the
 * given slot. Immutable — returns a new card.
 */
export function moveToBattlefield(
  card: GameCard,
  battlefieldOwnerId: string,
  slot: BattlefieldSlot,
): GameCard {
  return {
    ...card,
    zone: "battlefield",
    battlefieldOwnerId,
    slot,
  };
}

/**
 * Move a card to a non-battlefield zone. Clears any battlefield-specific
 * fields (position, tapped) since those don't apply off the battlefield.
 */
export function moveToZone(
  card: GameCard,
  zone: Exclude<Zone, "battlefield">,
): GameCard {
  return {
    ...card,
    zone,
    battlefieldOwnerId: undefined,
    slot: undefined,
    tapped: false,
  };
}

/** Toggle a battlefield card's tapped state. No-op off the battlefield. */
export function toggleTapped(card: GameCard): GameCard {
  if (card.zone !== "battlefield") return card;
  return { ...card, tapped: !card.tapped };
}

/** Reposition a card that's already on some battlefield. */
export function moveOnBattlefield(
  card: GameCard,
  slot: BattlefieldSlot,
): GameCard {
  if (card.zone !== "battlefield") return card;
  return { ...card, slot };
}
