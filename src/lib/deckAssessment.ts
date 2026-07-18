import { supabase } from "./supabase";
import { fetchCardCollection } from "./scryfall";
import { getCachedCard, preloadCards } from "./scryfallCache";
import { findCombosInDeck } from "./combos";
import {
  EXTRA_TURN_CHAIN_LIST_CI,
  MLD_CURATED_CI,
  normaliseName,
} from "./bracketRules";
import type { DeckCard } from "./decks";

export type AssessmentBracket = 2 | 3 | 4;

export type Assessment = {
  bracket: AssessmentBracket;
  totalPriceUsd: number;
  totalPriceMissingCount: number;
};

export type BracketRefs = {
  gameChangers: Set<string>;
  mld: Set<string>;
  extraTurns: Set<string>;
};

/**
 * Full deck assessment — bracket + total price — computed from the same rules
 * as DeckBreakdown but callable outside React. Used by:
 *   - DeckEditor auto-save after any card mutation
 *   - MyDecks per-row "Refresh" button
 *
 * Both callers can share the session-level Scryfall + combo caches, so the
 * cost of a repeat call is just the price lookup for any cards new to the
 * cache plus a single Commander Spellbook POST (also cached per fingerprint).
 */
export async function assessDeck(
  cards: DeckCard[],
  refs: BracketRefs,
): Promise<Assessment> {
  // 1. Warm price cache for anything missing from the session cache.
  const missingIds = cards
    .map((c) => c.card_scryfall_id)
    .filter((id) => !getCachedCard(id));
  if (missingIds.length > 0) {
    try {
      const { data } = await fetchCardCollection(
        missingIds.map((id) => ({ id })),
      );
      preloadCards(data);
    } catch {
      /* leave those prices as "missing" */
    }
  }

  // 2. Compute price totals + dedupe cards for bracket signals.
  let totalPriceUsd = 0;
  let totalPriceMissingCount = 0;
  const seen = new Set<string>();
  const unique: DeckCard[] = [];
  const cmcByOracle = new Map<string, number>();

  for (const c of cards) {
    const cached = getCachedCard(c.card_scryfall_id);
    const usd = cached?.prices?.usd ? Number(cached.prices.usd) : NaN;
    if (Number.isFinite(usd)) {
      totalPriceUsd += usd * c.quantity;
    } else {
      totalPriceMissingCount += c.quantity;
    }
    if (!seen.has(c.oracle_id)) {
      seen.add(c.oracle_id);
      unique.push(c);
      if (c.cmc !== null) cmcByOracle.set(c.oracle_id, c.cmc);
    }
  }

  // 3. Combos — one POST per deck, session-cached by fingerprint inside
  // findCombosInDeck. Missing/failed lookup returns an empty list and only
  // suppresses the "combo pushes bracket up" branch below.
  const uniqueNames = [...new Set(cards.map((c) => c.name))];
  let earlyCombos: Array<{ oracleIds: string[]; manaValueNeeded: number }> = [];
  try {
    const combos = await findCombosInDeck(uniqueNames);
    earlyCombos = combos.filter((combo) => {
      let total = combo.manaValueNeeded;
      for (const id of combo.oracleIds) total += cmcByOracle.get(id) ?? 0;
      return total < 8;
    });
  } catch {
    /* skip combos on failure — bracket is a lower bound */
  }

  // 4. Bracket — mirrors DeckBreakdown.estimateBracket exactly.
  const gc = unique.filter((c) => refs.gameChangers.has(c.oracle_id)).length;
  const mldN = unique.filter(
    (c) => refs.mld.has(c.oracle_id) || MLD_CURATED_CI.has(normaliseName(c.name)),
  ).length;
  const etN = unique.filter(
    (c) =>
      refs.extraTurns.has(c.oracle_id) ||
      EXTRA_TURN_CHAIN_LIST_CI.has(normaliseName(c.name)),
  ).length;
  const chainETN = unique.filter((c) =>
    EXTRA_TURN_CHAIN_LIST_CI.has(normaliseName(c.name)),
  ).length;
  const co = earlyCombos.length;

  let bracket: AssessmentBracket = 2;
  if (gc > 3 || mldN > 0 || co > 0 || chainETN > 0 || etN > 3) bracket = 4;
  else if (gc > 0 || etN > 2) bracket = 3;

  return { bracket, totalPriceUsd, totalPriceMissingCount };
}

/**
 * Compute an assessment for `deckId` (fetching its cards first) and write
 * the result back to the deck row. Used by the MyDecks refresh button.
 */
export async function refreshDeckAssessment(
  deckId: string,
  refs: BracketRefs,
): Promise<Assessment> {
  const { data, error } = await supabase
    .from("deck_cards")
    .select("*")
    .eq("deck_id", deckId);
  if (error) throw error;
  const cards = (data ?? []) as DeckCard[];
  const assessment = await assessDeck(cards, refs);
  await saveAssessment(deckId, assessment);
  return assessment;
}

/**
 * Persist a computed assessment on the deck row. Split from `assessDeck` so
 * callers can decide when to write (e.g. the editor debounces).
 */
export async function saveAssessment(
  deckId: string,
  assessment: Assessment,
): Promise<void> {
  const { error } = await supabase
    .from("decks")
    .update({
      bracket: assessment.bracket,
      total_price_usd: assessment.totalPriceUsd,
      total_price_missing_count: assessment.totalPriceMissingCount,
      bracket_assessed_at: new Date().toISOString(),
    })
    .eq("id", deckId);
  if (error) throw error;
}

/** Fingerprint the cards so the editor's auto-save can skip no-op runs. */
export function fingerprintDeck(cards: DeckCard[]): string {
  return cards
    .map((c) => `${c.card_scryfall_id}x${c.quantity}c${c.category}`)
    .sort()
    .join("|");
}
