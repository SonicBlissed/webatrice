/**
 * Curated card lists that edhpowerlevel.com augments its Scryfall tag lookups
 * with. Matching is done by canonical card name (case-insensitive, trimmed)
 * because the source article lists cards by name, not oracle_id.
 *
 * Source: https://edhpowerlevel.com — their "Brackets" methodology page.
 * Sync date: 2026-07-13.
 */

/**
 * Additional Mass Land Denial cards that Scryfall's `otag:mass-land-denial`
 * doesn't reliably catch. Union with the tag set for detection.
 */
export const MLD_CURATED = new Set<string>([
  "Vorinclex, Voice of Hunger",
  "Hall of Gemstone",
  "Contamination",
  "Cataclysm",
  "Dimensional Breach",
  "Epicenter",
  "Global Ruin",
  "Hokori, Dust Drinker",
  "Razia's Purification",
  "Rising Waters",
  "Soulscour",
  "Sunder",
  "Apocalypse",
  "Bearer of the Heavens",
  "Conversion",
  "Glaciers",
  "Pox",
  "Death Cloud",
  "Tangle Wire",
  "Restore Balance",
  "Realm Razer",
  "Spreading Algae",
  "Numot, the Devastator",
  "Kudzu",
  "Demonic Hordes",
  "Urza's Sylex",
  "Infernal Darkness",
  "Trinisphere",
  "Worldfire",
  "Worldslayer",
  "Gilt-Leaf Archdruid",
  "Worldpurge",
  "Stasis",
]);

/**
 * Extra-turn cards that are trivially chainable — either they self-reference,
 * live on a permanent that generates them repeatedly, or their acquisition is
 * effectively free. Presence of ANY of these pushes a deck to Bracket 4+ per
 * edhpowerlevel's rubric, regardless of the total extra-turn card count.
 */
export const EXTRA_TURN_CHAIN_LIST = new Set<string>([
  "Time Warp",
  "Temporal Manipulation",
  "Walk the Aeons",
  "Capture of Jingzhou",
  "Expropriate",
  "Time Stretch",
  "Nexus of Fate",
  "Timestream Navigator",
  "Sage of Hours",
  "Lighthouse Chronologist",
  "Time Sieve",
  "Magosi, the Waterveil",
]);

/**
 * Normalise a card name for set lookup — trim + case-fold. Callers should
 * use this when checking if a DeckCard is in one of the sets above.
 */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/** Case-insensitive Set from a name array. Used at module init for the sets above. */
function ciSet(source: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const n of source) out.add(normaliseName(n));
  return out;
}

export const MLD_CURATED_CI = ciSet(MLD_CURATED);
export const EXTRA_TURN_CHAIN_LIST_CI = ciSet(EXTRA_TURN_CHAIN_LIST);
