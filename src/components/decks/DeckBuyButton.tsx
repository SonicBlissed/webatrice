import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, Loader2 } from "lucide-react";
import { fetchCardCollection } from "@/lib/scryfall";
import { getCachedCard, preloadCards } from "@/lib/scryfallCache";
import type { DeckCard } from "@/lib/decks";

/**
 * "Buy deck @ TCGplayer" pill under the deck header. Sums TCGplayer USD prices
 * (usd × quantity) across every deck row and links to TCGplayer's mass-entry
 * cart pre-filled with the deck list.
 */
type Props = { cards: DeckCard[] };

// TCGplayer's Mass Entry parser is fussy about the exact `c=` shape:
//   - Entries are separated by a LITERAL `||` (no encoding, no newlines).
//   - Spaces are `%20` (not `+`, which URLSearchParams would produce).
//   - Apostrophes and `!` must stay literal — the parser doesn't decode
//     `%27` / `%21` when splitting the list.
// We build the query by hand so those escaping quirks stay under our control.
function encodeCardToken(name: string): string {
  return encodeURIComponent(name)
    .replace(/%27/g, "'")
    .replace(/%21/g, "!");
}

function buildMassEntryUrl(cards: DeckCard[]): string {
  const entries = cards
    .filter((c) => c.quantity > 0 && c.name)
    .map((c) => {
      // Format expected by TCGplayer: `qty name [SET] number`
      //   - Brackets encode as %5B / %5D
      //   - Set + collector number narrow the match to the exact printing
      //     rather than TCGplayer's default match. Some collector numbers
      //     have special chars (e.g. `TSP-3`, `146★`) so encode them.
      const parts: string[] = [`${c.quantity}%20${encodeCardToken(c.name)}`];
      if (c.set) parts.push(`%5B${c.set.toUpperCase()}%5D`);
      if (c.collector_number) parts.push(encodeCardToken(c.collector_number));
      return parts.join("%20");
    })
    .join("||");
  return `https://www.tcgplayer.com/massentry?c=${entries}&productline=Magic`;
}

export default function DeckBuyButton({ cards }: Props) {
  const [loading, setLoading] = useState(false);
  const [priced, setPriced] = useState(0);

  // Serialize the id/qty list into a stable key so the effect only refires
  // when the deck's composition changes.
  const key = useMemo(
    () =>
      cards
        .map((c) => `${c.card_scryfall_id}x${c.quantity}`)
        .sort()
        .join("|"),
    [cards],
  );

  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (cards.length === 0) {
      setTotal(0);
      setPriced(0);
      return;
    }

    // Fetch anything we don't already have in the session cache, then
    // recompute the whole total from the cache in one pass.
    const missingIds = cards
      .map((c) => c.card_scryfall_id)
      .filter((id) => getCachedCard(id) === undefined);

    const computeTotal = () => {
      let sum = 0;
      let count = 0;
      for (const row of cards) {
        const card = getCachedCard(row.card_scryfall_id);
        const usd = card?.prices?.usd ? Number(card.prices.usd) : NaN;
        if (Number.isFinite(usd)) {
          sum += usd * row.quantity;
          count += row.quantity;
        }
      }
      return { sum, count };
    };

    if (missingIds.length === 0) {
      const { sum, count } = computeTotal();
      setTotal(sum);
      setPriced(count);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const { data } = await fetchCardCollection(
          missingIds.map((id) => ({ id })),
        );
        preloadCards(data);
      } catch {
        // Silent — leave the total to whatever we could price from cache.
      } finally {
        if (!cancelled) {
          const { sum, count } = computeTotal();
          setTotal(sum);
          setPriced(count);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  const totalCount = cards.reduce((n, c) => n + c.quantity, 0);
  const missing = totalCount - priced;
  const href = buildMassEntryUrl(cards);

  const disabled = cards.length === 0;

  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <ShoppingCart size={13} />
        Buy deck @ TCGplayer
      </span>
      <span className="tabular-nums text-sm font-semibold flex items-center gap-1">
        {loading && <Loader2 size={11} className="animate-spin" />}
        ${total.toFixed(2)}
      </span>
    </>
  );

  const shared =
    "w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border transition-colors";

  if (disabled) {
    return (
      <div
        className={`${shared} bg-accent-secondary/20 border-accent/20 text-text-muted cursor-not-allowed`}
        title="Add cards to enable"
      >
        {inner}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the full deck in TCGplayer's mass-entry cart (opens in a new tab)"
        className={`${shared} bg-accent-secondary/50 hover:bg-accent-secondary border-accent/40 hover:border-accent text-white shadow-glow`}
      >
        {inner}
      </a>
      {missing > 0 && !loading && (
        <div className="text-[10px] text-text-muted italic px-1">
          Price missing for {missing} card{missing === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
