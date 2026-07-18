import { Loader2 } from "lucide-react";
import { cardImage } from "@/lib/scryfall";
import { useScryfallCard } from "@/lib/scryfallCache";
import CardPrices from "./CardPrices";

/**
 * Big card image on the left rail of the deck editor. Mirrors Moxfield's
 * always-visible preview panel — updates as the user hovers cards in the
 * deck list, and defaults to the commander (or first card alphabetically)
 * when nothing has been hovered yet.
 *
 * We accept just the scryfall id + a display name so the caller can control
 * what "current preview" means without threading a full DeckCard object.
 */
type Props = {
  scryfallId: string | null;
  name?: string;
};

export default function CardImagePreview({ scryfallId, name }: Props) {
  const { card, loading } = useScryfallCard(scryfallId, !!scryfallId);
  const img = card ? cardImage(card, "normal") : null;

  return (
    <div className="w-full max-w-[300px] mx-auto">
      <div className="aspect-[5/7] w-full rounded-xl overflow-hidden bg-bg-elevated border border-border-subtle shadow-glow flex items-center justify-center">
        {img ? (
          <img
            key={img}
            src={img}
            alt={name ?? card?.name ?? ""}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : loading ? (
          <Loader2 size={20} className="animate-spin text-text-muted" />
        ) : (
          <div className="text-xs text-text-muted text-center px-4">
            Hover a card to preview
          </div>
        )}
      </div>
      {(name ?? card?.name) && (
        <div className="mt-3 text-center text-sm font-medium text-text-primary truncate">
          {name ?? card?.name}
        </div>
      )}
      {card && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <CardPrices card={card} />
        </div>
      )}
    </div>
  );
}
