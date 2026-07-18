import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { cardImage, type ScryfallCard } from "./scryfall";

export type DeckCategory = "main" | "commander" | "sideboard";

export type Deck = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  bracket: number | null;
  bracket_assessed_at: string | null;
  total_price_usd: number | null;
  total_price_missing_count: number;
  created_at: string;
  updated_at: string;
};

export type DeckCard = {
  id: string;
  deck_id: string;
  card_scryfall_id: string;
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  type_line: string | null;
  cmc: number | null;
  colors: string[];
  image_uri: string | null;
  set: string | null;
  collector_number: string | null;
  /** Creatures only. Cached from Scryfall at ingest time; NULL for
   *  non-creatures. Strings to preserve variable stats ("*", "1+*"). */
  power: string | null;
  toughness: string | null;
  quantity: number;
  category: DeckCategory;
  position: number;
  created_at: string;
};

/** Live list of decks owned by the current user, most-recently-edited first. */
export function useMyDecks(userId: string | undefined) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setDecks([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      setError(error.message);
      setDecks([]);
    } else {
      setError(null);
      setDecks((data ?? []) as Deck[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { decks, loading, error, refetch };
}

/** Live view of a single deck + its cards. */
export function useDeck(deckId: string | undefined) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!deckId) return;
    const [deckRes, cardsRes] = await Promise.all([
      supabase.from("decks").select("*").eq("id", deckId).maybeSingle(),
      supabase
        .from("deck_cards")
        .select("*")
        .eq("deck_id", deckId)
        .order("category")
        .order("name"),
    ]);
    if (deckRes.error) setError(deckRes.error.message);
    else if (cardsRes.error) setError(cardsRes.error.message);
    else {
      setError(null);
      setDeck((deckRes.data as Deck | null) ?? null);
      setCards((cardsRes.data ?? []) as DeckCard[]);
    }
    setLoading(false);
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;
    void refetch();
  }, [deckId, refetch]);

  return { deck, cards, loading, error, refetch };
}

// ---------- Actions ----------

export async function createDeck(ownerId: string, name = "Untitled deck"): Promise<Deck> {
  const { data, error } = await supabase
    .from("decks")
    .insert({ owner_id: ownerId, name })
    .select()
    .single();
  if (error) throw error;
  return data as Deck;
}

export async function updateDeck(
  deckId: string,
  patch: Partial<
    Pick<
      Deck,
      | "name"
      | "description"
      | "bracket"
      | "bracket_assessed_at"
      | "total_price_usd"
      | "total_price_missing_count"
    >
  >,
): Promise<Deck> {
  const { data, error } = await supabase
    .from("decks")
    .update(patch)
    .eq("id", deckId)
    .select()
    .single();
  if (error) throw error;
  return data as Deck;
}

export async function deleteDeck(deckId: string): Promise<void> {
  const { error } = await supabase.from("decks").delete().eq("id", deckId);
  if (error) throw error;
}

type NewDeckCard = {
  deck_id: string;
  card_scryfall_id: string;
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  type_line: string | null;
  cmc: number | null;
  colors: string[];
  image_uri: string | null;
  set: string | null;
  collector_number: string | null;
  power: string | null;
  toughness: string | null;
  quantity: number;
  category: DeckCategory;
};

/**
 * Turn a Scryfall card into the DB row shape. Extracted so `addCardToDeck`
 * and the importer both use the same field mapping.
 */
export function deckCardFromScryfall(
  deckId: string,
  card: ScryfallCard,
  opts: { quantity?: number; category?: DeckCategory } = {},
): NewDeckCard {
  return {
    deck_id: deckId,
    card_scryfall_id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? null,
    type_line: card.type_line ?? card.card_faces?.[0]?.type_line ?? null,
    cmc: typeof card.cmc === "number" ? card.cmc : null,
    colors: card.colors ?? [],
    image_uri: cardImage(card, "small"),
    set: card.set ?? null,
    collector_number: card.collector_number ?? null,
    power: card.power ?? card.card_faces?.[0]?.power ?? null,
    toughness: card.toughness ?? card.card_faces?.[0]?.toughness ?? null,
    quantity: opts.quantity ?? 1,
    category: opts.category ?? "main",
  };
}

/** Insert a card into the deck. If a row already exists (same oracle+category), bump its quantity. */
export async function addCardToDeck(
  deckId: string,
  card: ScryfallCard,
  opts: { category?: DeckCategory } = {},
): Promise<void> {
  if (!card.id || !card.oracle_id) {
    throw new Error(
      `Card is missing required identifiers (id=${card.id ?? "?"}, oracle_id=${
        card.oracle_id ?? "?"
      }, name=${card.name ?? "?"}). Cannot add.`,
    );
  }
  const row = deckCardFromScryfall(deckId, card, { quantity: 1, category: opts.category });
  // `.select("id").single()` forces Supabase to echo the inserted row back.
  // Without it, an insert that silently affected zero rows (e.g. an RLS
  // policy mismatch we didn't anticipate) would look identical to success.
  const { data: inserted, error } = await supabase
    .from("deck_cards")
    .insert(row)
    .select("id")
    .single();
  if (!error && inserted) return;
  if (error?.code === "23505") {
    // Existing row — fetch, add 1, update.
    const existingCategory = row.category;
    const { data: existing, error: readError } = await supabase
      .from("deck_cards")
      .select("id, quantity")
      .eq("deck_id", deckId)
      .eq("oracle_id", card.oracle_id)
      .eq("category", existingCategory)
      .maybeSingle();
    if (readError || !existing) throw readError ?? new Error("card exists but could not be read");
    const { error: bumpError } = await supabase
      .from("deck_cards")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
    if (bumpError) throw bumpError;
    return;
  }
  throw error ?? new Error("Insert succeeded but returned no row — check RLS or session state.");
}

/**
 * Change the printing of a card in the deck without changing its quantity.
 * If the card isn't in the deck yet, insert it with quantity 1 using this
 * printing. Called by the printing picker whether triggered from search
 * results or from a deck row's "change printing" action.
 */
export async function pickPrintingForDeck(
  deckId: string,
  card: ScryfallCard,
  opts: { category?: DeckCategory } = {},
): Promise<void> {
  if (!card.id || !card.oracle_id) {
    throw new Error("Card is missing required identifiers.");
  }
  const category = opts.category ?? "main";
  const { data: existing, error: readError } = await supabase
    .from("deck_cards")
    .select("id")
    .eq("deck_id", deckId)
    .eq("oracle_id", card.oracle_id)
    .eq("category", category)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    // Preserve quantity; swap the printing-related fields to the new choice.
    const patch = {
      card_scryfall_id: card.id,
      image_uri: cardImage(card, "small"),
      set: card.set ?? null,
      collector_number: card.collector_number ?? null,
      // Refresh the cached display fields too — printings can vary in mana
      // cost / type only rarely (e.g. errata), but keeping them in sync
      // with the picked printing avoids surprises.
      mana_cost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? null,
      type_line: card.type_line ?? card.card_faces?.[0]?.type_line ?? null,
      cmc: typeof card.cmc === "number" ? card.cmc : null,
      colors: card.colors ?? [],
      power: card.power ?? card.card_faces?.[0]?.power ?? null,
      toughness: card.toughness ?? card.card_faces?.[0]?.toughness ?? null,
    };
    const { error } = await supabase
      .from("deck_cards")
      .update(patch)
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }
  // Not in deck — fall through to the normal add path so all the
  // NOT-NULL / RLS handling lives in one place.
  await addCardToDeck(deckId, card, opts);
}

/** Batch-insert many cards. Used by the importer. */
export async function insertDeckCards(rows: NewDeckCard[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("deck_cards").insert(rows);
  if (error) throw error;
}

export async function updateCardQuantity(cardRowId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await removeCard(cardRowId);
    return;
  }
  const { error } = await supabase.from("deck_cards").update({ quantity }).eq("id", cardRowId);
  if (error) throw error;
}

export async function removeCard(cardRowId: string): Promise<void> {
  const { error } = await supabase.from("deck_cards").delete().eq("id", cardRowId);
  if (error) throw error;
}

/**
 * Re-insert a previously-deleted DeckCard row verbatim. Used by the Ctrl/Cmd+Z
 * undo path — we captured the full row before deletion so we can restore its
 * exact printing, quantity, and category.
 *
 * If a card with the same (deck_id, oracle_id, category) has been re-added
 * (e.g. via search) since the delete, the unique constraint triggers the
 * "bump quantity" path so the user's original quantity gets folded back in.
 */
export async function restoreDeckCard(card: DeckCard): Promise<void> {
  const row: NewDeckCard = {
    deck_id: card.deck_id,
    card_scryfall_id: card.card_scryfall_id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    type_line: card.type_line,
    cmc: card.cmc,
    colors: card.colors,
    image_uri: card.image_uri,
    set: card.set,
    collector_number: card.collector_number,
    power: card.power,
    toughness: card.toughness,
    quantity: card.quantity,
    category: card.category,
  };
  const { error } = await supabase.from("deck_cards").insert(row);
  if (!error) return;
  if (error.code === "23505") {
    // Card was re-added between delete and undo. Fold the restored quantity
    // into the existing row so the undo isn't lost.
    const { data: existing, error: readError } = await supabase
      .from("deck_cards")
      .select("id, quantity")
      .eq("deck_id", card.deck_id)
      .eq("oracle_id", card.oracle_id)
      .eq("category", card.category)
      .maybeSingle();
    if (readError || !existing) throw readError ?? new Error("row missing after conflict");
    const { error: bumpError } = await supabase
      .from("deck_cards")
      .update({ quantity: existing.quantity + card.quantity })
      .eq("id", existing.id);
    if (bumpError) throw bumpError;
    return;
  }
  throw error;
}

export async function setCategory(cardRowId: string, category: DeckCategory): Promise<void> {
  const { error } = await supabase.from("deck_cards").update({ category }).eq("id", cardRowId);
  if (error) throw error;
}

// ---------- Grouping helpers for the deck editor UI ----------

const TYPE_ORDER = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Enchantment",
  "Artifact",
  "Land",
  "Other",
] as const;

export type CardTypeGroup = (typeof TYPE_ORDER)[number];

/** Return the primary card type used for grouping — Creature > Planeswalker > … > Land. */
export function primaryType(typeLine: string | null): CardTypeGroup {
  if (!typeLine) return "Other";
  // Type line looks like: "Legendary Creature — Human Wizard" or
  // "Instant" or "Artifact — Equipment". Split on em-dash first.
  const front = typeLine.split("—")[0];
  for (const t of TYPE_ORDER) {
    if (front.includes(t)) return t;
  }
  return "Other";
}

export function groupCardsByType(cards: DeckCard[]): Record<CardTypeGroup, DeckCard[]> {
  const out = {} as Record<CardTypeGroup, DeckCard[]>;
  for (const t of TYPE_ORDER) out[t] = [];
  for (const c of cards) out[primaryType(c.type_line)].push(c);
  return out;
}
