/**
 * The seven zones a card can live in during a Magic game. Every game card
 * has a `zone` field that names one of these, and card-movement operations
 * (draw, discard, cast, resolve, exile, tuck, etc.) are all ultimately "set
 * this card's zone to X".
 *
 * Naming note: we use camelCase for multi-word zones so the values plug
 * cleanly into TypeScript switch/record keys without quoting.
 */

export type Zone =
  | "library"
  | "graveyard"
  | "exile"
  | "hand"
  | "commandZone"
  | "stack"
  | "battlefield";

/** All zones in a deterministic order — useful for iterating in tests / UI. */
export const ZONES: readonly Zone[] = [
  "library",
  "graveyard",
  "exile",
  "hand",
  "commandZone",
  "stack",
  "battlefield",
] as const;

/** Human-readable labels for zones — the strings we display in the UI. */
export const ZONE_LABEL: Record<Zone, string> = {
  library:     "Library",
  graveyard:   "Graveyard",
  exile:       "Exile",
  hand:        "Hand",
  commandZone: "Command Zone",
  stack:       "Stack",
  battlefield: "Battlefield",
};

/**
 * Zones that are hidden from opponents. Cards in these zones show as
 * face-down / count-only when rendered for anyone but the owner.
 */
export const HIDDEN_ZONES: ReadonlySet<Zone> = new Set(["library", "hand"]);

/** True when the given zone hides its cards from opponents. */
export function isHiddenZone(zone: Zone): boolean {
  return HIDDEN_ZONES.has(zone);
}
