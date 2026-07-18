import { useEffect, useState } from "react";
import { fetchBracketTag, fetchGameChangers } from "./scryfall";
import type { BracketTag, ScryfallCard } from "./scryfall";

/**
 * Session-scoped in-memory cache of ScryfallCards keyed by Scryfall id.
 *
 * `useScryfallCard(id)` returns cache-hit synchronously; on miss it fetches
 * from Scryfall and stores the result. `preloadCards` lets other parts of
 * the app (e.g. search results) warm the cache proactively so hovering a
 * result is instant instead of triggering a network roundtrip.
 */
const cache = new Map<string, ScryfallCard>();

// Track in-flight fetches so simultaneous hovers of the same card don't
// duplicate work.
const inflight = new Map<string, Promise<ScryfallCard | null>>();

export function preloadCards(cards: ScryfallCard[]): void {
  for (const c of cards) cache.set(c.id, c);
}

export function getCachedCard(id: string): ScryfallCard | undefined {
  return cache.get(id);
}

async function fetchCardById(id: string): Promise<ScryfallCard | null> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as ScryfallCard;
      cache.set(id, data);
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/**
 * Read a Scryfall card by id, fetching + caching if unknown. `enabled` lets
 * callers gate the fetch (e.g. only when the tooltip is actually visible).
 */
export function useScryfallCard(id: string | null | undefined, enabled = true) {
  const initial = id ? cache.get(id) ?? null : null;
  const [card, setCard] = useState<ScryfallCard | null>(initial);
  const [loading, setLoading] = useState<boolean>(!!id && !initial && enabled);

  useEffect(() => {
    if (!id || !enabled) {
      setCard(id ? cache.get(id) ?? null : null);
      setLoading(false);
      return;
    }
    const hit = cache.get(id);
    if (hit) {
      setCard(hit);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCardById(id).then((c) => {
      if (cancelled) return;
      setCard(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, enabled]);

  return { card, loading };
}

/**
 * Fetch WotC's Game Changers list (via Scryfall's `is:gamechanger` operator)
 * and return the set of oracle_ids. The underlying fetch is cached module-
 * level in scryfall.ts so this hook is effectively a one-time load per session.
 */
export function useGameChangers() {
  const [set, setSet] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGameChangers()
      .then((s) => {
        if (cancelled) return;
        setSet(s);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load game changers");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { set, loading, error };
}

/**
 * Load the session-wide reference data needed for a Commander bracket
 * estimate. Follows edhpowerlevel.com's ruleset:
 *   - Game Changers (WotC list, via `is:gamechanger`)
 *   - MLD (Scryfall tag; a curated supplemental list is applied by name in the caller)
 *   - Extra turns (Scryfall tag; a "chain" subset is applied by name in the caller)
 *
 * Tutors were dropped from WotC's bracket rules in October 2025, and
 * edhpowerlevel followed suit — so we no longer fetch that list here.
 * Combos live in a separate per-deck POST to Commander Spellbook.
 */
export type BracketData = {
  gameChangers: Set<string> | null;
  mld: Set<string> | null;
  extraTurns: Set<string> | null;
  loading: boolean;
  error: string | null;
};

export function useBracketData(): BracketData {
  const [gameChangers, setGameChangers] = useState<Set<string> | null>(null);
  const [mld, setMld] = useState<Set<string> | null>(null);
  const [extraTurns, setExtraTurns] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (
      tag: BracketTag,
      setter: (s: Set<string>) => void,
    ) => {
      try {
        const s = await fetchBracketTag(tag);
        if (!cancelled) setter(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : `Failed: ${tag}`);
      }
    };
    void load("gamechanger", setGameChangers);
    void load("mass-land-denial", setMld);
    void load("extra-turn", setExtraTurns);
    return () => {
      cancelled = true;
    };
  }, []);

  const loading =
    gameChangers === null ||
    mld === null ||
    extraTurns === null;

  return { gameChangers, mld, extraTurns, loading, error };
}
