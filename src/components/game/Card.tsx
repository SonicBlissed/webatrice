import { CARD_CORNER_RADIUS, CARD_HEIGHT, CARD_WIDTH } from "./cardSize";
import { useHoveredCard } from "./hoveredCard";

/**
 * A single MTG card on the play area. First cut: just the printed card image
 * pulled from Scryfall at our standard card size.
 * No interactivity yet — tap / drag / hover-preview land in a later slice.
 *
 * Prefer `scryfallId` when known (it fetches the exact printing the deck
 * chose); `name` is the fallback that resolves to Scryfall's default printing.
 */
type Props = {
  name: string;
  scryfallId?: string;
};

export default function Card({ name, scryfallId }: Props) {
  // Scryfall's card-by-id endpoint returns the exact printing chosen in the
  // deck. The named endpoint is only used as a fallback when we don't have
  // an id.
  //
  // `large` (672×936, ~100KB JPG) is ~half the download of `png` (lossless
  // 745×1040, ~200KB) and looks basically identical at our display size.
  // Faster load matters more here than a slight quality bump.
  const imageUrl = scryfallId
    ? `https://api.scryfall.com/cards/${scryfallId}?format=image&version=large`
    : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
        name,
      )}&format=image&version=large`;

  const { setHoveredCard } = useHoveredCard();

  return (
    <div
      className="relative shadow-md select-none overflow-hidden transition-transform duration-150 ease-out hover:scale-[1.06]"
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderRadius: CARD_CORNER_RADIUS,
      }}
      title={name}
      onMouseEnter={() => setHoveredCard({ name, scryfallId })}
    >
      <img
        src={imageUrl}
        alt={name}
        draggable={false}
        className="w-full h-full"
        style={{ imageRendering: "-webkit-optimize-contrast" }}
      />
      {/* Card name — small pill overlay at the top; black bg is tight to
          the text, not spanning the whole card width. */}
      <div className="absolute top-1 left-0 right-0 flex justify-center px-1">
        <span className="bg-black text-white text-[0.5rem] font-semibold leading-none px-1.5 py-0.5 rounded truncate max-w-full">
          {name}
        </span>
      </div>
    </div>
  );
}
