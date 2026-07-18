import { ShoppingCart } from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";

/**
 * TCGplayer "buy" pill for the specific printing on the given card.
 * Full-width button styled with the app's accent palette; clicking opens
 * Scryfall's affiliate purchase URI in a new tab and lands on the exact
 * printing's TCGplayer product page.
 */
type Props = {
  card: ScryfallCard | null | undefined;
};

export default function CardPrices({ card }: Props) {
  const usd = card?.prices?.usd ?? null;
  const href = card?.purchase_uris?.tcgplayer ?? null;

  if (!usd) {
    return (
      <div className="text-xs text-text-muted italic">No TCGplayer price</div>
    );
  }

  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <ShoppingCart size={13} />
        Buy @ TCGplayer
      </span>
      <span className="tabular-nums text-sm font-semibold">${usd}</span>
    </>
  );

  const shared =
    "w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border transition-colors";

  if (!href) {
    // Same visual style, but non-interactive.
    return (
      <div
        className={`${shared} bg-accent-secondary/30 border-accent/30 text-text-primary`}
      >
        {inner}
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Buy on TCGplayer (opens in a new tab)"
      className={`${shared} bg-accent-secondary/50 hover:bg-accent-secondary border-accent/40 hover:border-accent text-white shadow-glow`}
    >
      {inner}
    </a>
  );
}
