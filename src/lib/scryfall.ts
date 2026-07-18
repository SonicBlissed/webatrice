/**
 * Thin Scryfall API client. Only the endpoints we actually use:
 *   - GET /cards/search       — for the search box in the deck editor
 *   - POST /cards/collection  — for batch resolution during import
 *   - GET /cards/named        — occasional single-card lookups
 *
 * Scryfall asks for 50–100ms between requests. The search calls are already
 * debounced by the UI; the collection endpoint is one-shot so no throttling
 * is needed there.
 *
 * We don't use `scryfall-sdk` because its API surface is much larger than
 * what this app needs and it pulls in a Node-oriented rate limiter.
 */

const BASE = "https://api.scryfall.com";

/** Fields we care about — Scryfall returns many more but we only cache these. */
export type ScryfallCard = {
  id: string;
  oracle_id: string;
  name: string;
  set?: string;
  collector_number?: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  colors?: string[];
  color_identity?: string[];
  /** Creatures only. Strings because Scryfall preserves the printed value:
   *  most cards use "2", "3", etc., but variable creatures use "*", "1+*",
   *  and a few oddballs use "?" or infinity. Non-creatures omit them. */
  power?: string;
  toughness?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
  // Double-faced cards keep image_uris + text under card_faces
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    flavor_text?: string;
    image_uris?: { small?: string; normal?: string; art_crop?: string };
    power?: string;
    toughness?: string;
  }>;
  legalities?: Record<string, string>;
  /** Scryfall exposes TCGplayer USD, Cardmarket EUR, and MTGO tix here. */
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
    tix?: string | null;
  };
  /** Deep links to the exact printing on partner marketplaces. */
  purchase_uris?: {
    tcgplayer?: string;
    cardmarket?: string;
    cardhoarder?: string;
  };
};

/** Pick a small thumbnail URL, tolerating single- vs double-faced cards. */
export function cardImage(card: ScryfallCard, size: "small" | "normal" = "small"): string | null {
  return (
    card.image_uris?.[size] ??
    card.card_faces?.[0]?.image_uris?.[size] ??
    null
  );
}

/** Simple named-search fallback used by the search box. */
export async function searchCards(query: string, signal?: AbortSignal): Promise<ScryfallCard[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/cards/search?q=${encodeURIComponent(q)}&order=name&unique=cards`;
  const res = await fetch(url, { signal });
  if (res.status === 404) return []; // "no results" comes back as 404 from Scryfall
  if (!res.ok) throw new Error(`Scryfall search failed: ${res.status}`);
  const body = (await res.json()) as { data?: ScryfallCard[] };
  return body.data ?? [];
}

/**
 * All printings for a given oracle_id, newest-first. Used by the printing
 * picker so a user can choose which art to put in their deck. Returns page 1
 * only (up to 175 printings) — cards with more will be truncated. Pagination
 * can be added later if we ever run into a card with that many prints.
 */
export async function fetchAllPrintings(
  oracleId: string,
  signal?: AbortSignal,
): Promise<ScryfallCard[]> {
  const url = `${BASE}/cards/search?q=${encodeURIComponent(
    `oracleid:${oracleId}`,
  )}&unique=prints&order=released&dir=desc`;
  const res = await fetch(url, { signal });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall printings fetch failed: ${res.status}`);
  const body = (await res.json()) as { data?: ScryfallCard[] };
  return body.data ?? [];
}

/**
 * Autocomplete card names as the user types. Scryfall's endpoint returns
 * up to 20 fuzzy-matching card names (strings only, no card data) — cheap
 * enough to call on every keystroke with a short debounce.
 */
export async function autocompleteCards(
  prefix: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const q = prefix.trim();
  if (q.length === 0) return [];
  const res = await fetch(
    `${BASE}/cards/autocomplete?q=${encodeURIComponent(q)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`Scryfall autocomplete failed: ${res.status}`);
  const body = (await res.json()) as { data?: string[] };
  return body.data ?? [];
}

/** Look up a single card by exact name. Returns null for not-found. */
export async function findCardByName(name: string, signal?: AbortSignal): Promise<ScryfallCard | null> {
  const url = `${BASE}/cards/named?exact=${encodeURIComponent(name)}`;
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall lookup failed: ${res.status}`);
  return (await res.json()) as ScryfallCard;
}

export type CollectionIdentifier =
  | { name: string }
  | { id: string }
  | { oracle_id: string }
  | { set: string; collector_number: string };

// ---------- Bracket signal tags ----------

/**
 * Categories of cards we care about for Commander bracket estimation. Each
 * maps to a Scryfall search query — `is:gamechanger` for WotC's official
 * list, and community-maintained `otag:` (oracle-tag) lists for the rest.
 */
export type BracketTag = "gamechanger" | "tutor" | "mass-land-denial" | "extra-turn";

const BRACKET_TAG_QUERY: Record<BracketTag, string> = {
  gamechanger: "is:gamechanger",
  tutor: "otag:tutor",
  "mass-land-denial": "otag:mass-land-denial",
  "extra-turn": "otag:extra-turn",
};

const tagCache: Partial<Record<BracketTag, Set<string>>> = {};
const tagInflight: Partial<Record<BracketTag, Promise<Set<string>>>> = {};

/**
 * Fetch the set of oracle_ids for a given bracket tag. Handles Scryfall's
 * pagination (`has_more` / `next_page`) since tutors and MLD both spill past
 * one page of results. Cache is module-level so calling this once per session
 * is enough.
 */
export async function fetchBracketTag(tag: BracketTag): Promise<Set<string>> {
  if (tagCache[tag]) return tagCache[tag]!;
  const existing = tagInflight[tag];
  if (existing) return existing;
  const p = (async () => {
    const set = new Set<string>();
    let next: string | null =
      `${BASE}/cards/search?q=${encodeURIComponent(BRACKET_TAG_QUERY[tag])}&unique=cards`;
    while (next) {
      const res = await fetch(next);
      // 404 from Scryfall search means "no cards match" — treat as empty.
      if (res.status === 404) break;
      if (!res.ok) throw new Error(`Scryfall ${tag} fetch failed: ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ oracle_id?: string }>;
        has_more?: boolean;
        next_page?: string;
      };
      for (const c of body.data ?? []) if (c.oracle_id) set.add(c.oracle_id);
      next = body.has_more && body.next_page ? body.next_page : null;
      if (next) await new Promise((r) => setTimeout(r, 100));
    }
    tagCache[tag] = set;
    return set;
  })();
  tagInflight[tag] = p;
  try {
    return await p;
  } finally {
    delete tagInflight[tag];
  }
}

/** Convenience for the existing Game Changers callers. */
export async function fetchGameChangers(): Promise<Set<string>> {
  return fetchBracketTag("gamechanger");
}

/**
 * Resolve up to 75 identifiers in a single call. For decks with more, chunk
 * before calling. Returns matched cards and a not_found list (the identifiers
 * that had no match) so the importer can surface them to the user.
 */
export async function fetchCardCollection(
  identifiers: CollectionIdentifier[],
  signal?: AbortSignal,
): Promise<{ data: ScryfallCard[]; not_found: CollectionIdentifier[] }> {
  if (identifiers.length === 0) return { data: [], not_found: [] };
  const chunks: CollectionIdentifier[][] = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    chunks.push(identifiers.slice(i, i + 75));
  }

  const all: ScryfallCard[] = [];
  const missing: CollectionIdentifier[] = [];
  for (const chunk of chunks) {
    const res = await fetch(`${BASE}/cards/collection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk }),
      signal,
    });
    if (!res.ok) throw new Error(`Scryfall collection failed: ${res.status}`);
    const body = (await res.json()) as {
      data?: ScryfallCard[];
      not_found?: CollectionIdentifier[];
    };
    all.push(...(body.data ?? []));
    missing.push(...(body.not_found ?? []));
    // Space between chunk requests to stay well inside Scryfall's rate window.
    if (chunks.length > 1) await new Promise((r) => setTimeout(r, 100));
  }
  return { data: all, not_found: missing };
}
