/**
 * Commander Spellbook combo detection.
 *
 * Rather than bulk-downloading their 30k+ combo dataset, we POST the deck's
 * card names to their `find-my-combos` endpoint and receive only the matches.
 * Cache is keyed by a deck fingerprint so navigating between decks doesn't
 * re-fetch the same result.
 *
 * The endpoint historically lives at:
 *   POST https://backend.commanderspellbook.com/find-my-combos
 *
 * Their payload shape has drifted across API versions; we handle multiple
 * historical spellings for card/result fields defensively. If the request
 * fails for any reason (URL change, CORS, downtime), we return an empty
 * combo list rather than blocking the bracket estimate.
 */

const FIND_URL = "https://backend.commanderspellbook.com/find-my-combos";

/** Normalised combo shape for the UI. */
export type Combo = {
  id: string;
  oracleIds: string[];
  names: string[];
  results: string[];
  /** Activation-side mana cost from CS. Add the CMCs of the `uses` cards to
   *  get the total mana required for the combo (edhpowerlevel's threshold). */
  manaValueNeeded: number;
};

const responseCache = new Map<string, Combo[]>();

/** Build a stable cache key from a deck's card name list. */
function deckKey(cardNames: string[]): string {
  const sorted = [...cardNames].sort();
  return sorted.join("|");
}

// Card entries in CS responses can appear under several keys depending on
// API version. This normaliser handles the ones we've seen in the wild.
type RawCard = {
  card?: { oracleId?: string; oracle_id?: string; name?: string };
  oracleId?: string;
  oracle_id?: string;
  name?: string;
};

function extractCards(entry: unknown): { oracleIds: string[]; names: string[] } {
  const oracleIds: string[] = [];
  const names: string[] = [];
  if (!entry || typeof entry !== "object") return { oracleIds, names };
  const e = entry as Record<string, unknown>;

  const collect = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr as RawCard[]) {
      const id =
        raw?.card?.oracleId ??
        raw?.card?.oracle_id ??
        raw?.oracleId ??
        raw?.oracle_id;
      const name = raw?.card?.name ?? raw?.name;
      if (id) oracleIds.push(id);
      if (name) names.push(name);
    }
  };
  collect(e.uses);
  collect(e.cards);

  if (Array.isArray(e.cardOracleIds)) {
    for (const id of e.cardOracleIds as unknown[]) {
      if (typeof id === "string") oracleIds.push(id);
    }
  }
  if (Array.isArray(e.cardNames)) {
    for (const n of e.cardNames as unknown[]) {
      if (typeof n === "string") names.push(n);
    }
  }
  return { oracleIds, names };
}

// edhpowerlevel disqualifies combos whose results are "does nothing" chains
// (infinite ETB alone, infinite storm count with no payoff, etc.). A feature
// counts as game-defining if it matches any keyword AND does not match any
// blacklist substring.
//
// Blacklist rationale:
//   - "lands you control can produce" flags conditional infinite mana that
//     only works if the deck already has good ramp — CS lists it as
//     "infinite mana" but it's not the win-here-now signal we want.
//   - "storm count" (as in "Infinite storm count") needs a payoff to win.
const GAME_DEFINING_KEYWORDS = [
  "mana",
  "life",
  "card", // "infinite cards" or "infinite card draw"
  "draw",
  "token",
  "win",
  "damage",
  "+1/+1", // infinite +1/+1 counters on a creature — wins via combat
];

const GAME_DEFINING_BLACKLIST = [
  "lands you control can produce",
  "storm count",
];

function hasGameDefiningEffect(features: string[]): boolean {
  for (const f of features) {
    const lower = f.toLowerCase();

    let blacklisted = false;
    for (const pat of GAME_DEFINING_BLACKLIST) {
      if (lower.includes(pat)) {
        blacklisted = true;
        break;
      }
    }
    if (blacklisted) continue;

    for (const kw of GAME_DEFINING_KEYWORDS) {
      if (lower.includes(kw)) return true;
    }
  }
  return false;
}

function extractResults(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const e = entry as Record<string, unknown>;
  const out: string[] = [];
  const collect = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr as Array<Record<string, unknown>>) {
      const name =
        (item?.feature as { name?: string } | undefined)?.name ??
        (item?.name as string | undefined);
      if (typeof name === "string") out.push(name);
    }
  };
  collect(e.produces);
  collect(e.results);
  return out;
}

/**
 * Ask Commander Spellbook which combos are already fully present in the
 * given deck. Returns an empty array (never throws) on any transport or
 * schema failure — combo detection is bonus signal, not a blocker.
 */
export async function findCombosInDeck(cardNames: string[]): Promise<Combo[]> {
  if (cardNames.length === 0) return [];
  const key = deckKey(cardNames);
  const cached = responseCache.get(key);
  if (cached) return cached;

  try {
    // The find-my-combos endpoint expects each card as an object, not a
    // bare string — DRF returned "Expected a dictionary, but got str."
    // when we sent plain names. The `card` + `quantity` shape matches the
    // schema used elsewhere in their API.
    const payload = {
      main: cardNames.map((name) => ({ card: name, quantity: 1 })),
      commanders: [],
    };
    const res = await fetch(FIND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[combos] ${FIND_URL} responded ${res.status}`);
      responseCache.set(key, []);
      return [];
    }
    const text = await res.text();
    if (!text) {
      responseCache.set(key, []);
      return [];
    }
    const body = JSON.parse(text) as unknown;

    // Their response has grown a nested `results` object. Both shapes seen:
    //   { included: [...], almost_included: [...] }
    //   { results: { included: [...], almost_included: [...] } }
    const outer = body as Record<string, unknown>;
    const nested =
      (outer.results as Record<string, unknown> | undefined) ?? outer;
    const included = Array.isArray(nested.included) ? nested.included : [];

    const combos: Combo[] = [];
    for (const entry of included as unknown[]) {
      const e = entry as Record<string, unknown>;
      const { oracleIds, names } = extractCards(e);
      if (names.length === 0 && oracleIds.length === 0) continue;

      // Filter to "two-card combos" that a bracket-check would care about:
      //   1. Exactly 2 named cards, no template requirements — the deck
      //      genuinely has all pieces.
      //   2. Produces a game-defining effect (mana/life/cards/tokens/win/
      //      damage/+1/+1). "Infinitely do nothing" chains don't count.
      //
      // The "early" mana check (edhpowerlevel: total mana < 8, including
      // CMC of both cards + activation) requires the deck's cached CMC
      // values so it happens in the DeckBreakdown caller — the manaValueNeeded
      // is preserved here for that math.
      const useCount = Math.max(names.length, oracleIds.length);
      const requiresLen = Array.isArray(e.requires) ? (e.requires as unknown[]).length : 0;
      if (useCount !== 2 || requiresLen > 0) continue;

      const results = extractResults(e);
      if (!hasGameDefiningEffect(results)) continue;

      const manaValueNeeded =
        typeof e.manaValueNeeded === "number" ? e.manaValueNeeded : 0;

      combos.push({
        id: String(e.id ?? names.join("|") ?? oracleIds.join("|")),
        oracleIds,
        names,
        results,
        manaValueNeeded,
      });
    }
    responseCache.set(key, combos);
    return combos;
  } catch (e) {
    console.error("[combos] find-my-combos failed:", e);
    responseCache.set(key, []);
    return [];
  }
}
