/**
 * Shared visual dimensions for MTG cards throughout the game view.
 *
 * Real cards are 5:7 portrait. Values below are expressed as rem so they're
 * root-anchored (browser default = 16px, so `8.75rem` renders at 140px).
 * Change these two numbers and every card-shaped element in the game view
 * — library, graveyard, exile, mana-pool box, hand-fan area, battlefield
 * cards — scales together.
 */

// Sized so 6 cards fit in each player's individual battlefield area (the
// space to the right of the info column, inside a single PlayerBox — not
// the whole screen). At 80px × 112px, six cards fit as a 3×2 grid inside
// roughly a 280px × 240px region with comfortable gaps.
//
// These reference CSS variables set by CardScaleProvider (see cardScale.tsx)
// at the game-area root. The `5rem` / `7rem` fallbacks are the 1x defaults,
// so anything outside the provider still renders at the original size.
export const CARD_WIDTH = "var(--card-width, 5rem)";
export const CARD_HEIGHT = "var(--card-height, 7rem)";

/** Same card rotated 90° — used for the "tapped" library stack. */
export const CARD_SIDEWAYS_WIDTH = CARD_HEIGHT;
export const CARD_SIDEWAYS_HEIGHT = CARD_WIDTH;

/** Canonical MTG card back — reused wherever we need a face-down card. */
export const CARD_BACK_URL =
  "https://backs.scryfall.io/normal/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

/**
 * ~7.5% of the card width matches the real MTG corner curve. Prevents the
 * white JPG background from peeking through rounded corners without eating
 * into meaningful art.
 */
export const CARD_CORNER_RADIUS = "7.5%";
