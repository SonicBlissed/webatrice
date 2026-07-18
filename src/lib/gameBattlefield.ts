/**
 * Battlefield grid + snap logic.
 *
 * A battlefield is a grid of card-sized slots with a fixed gap. The number
 * of rows and columns is derived from the container's actual dimensions —
 * whatever fits, fits. Cards snap to the nearest slot when dropped.
 *
 * Battlefields are per-player: each player has their own grid. A card can
 * live on any player's battlefield — its `battlefieldOwnerId` on the game
 * card names which one.
 *
 * All functions here are pure — no state, no side effects. UI and game-state
 * modules layer on top.
 */

/** Constant spacing between adjacent slots (px). */
export const BATTLEFIELD_GAP_PX = 20;

/** Diagonal offset (px) applied per additional card when multiple cards
 *  occupy the same slot — creates the "fan" stack look. */
export const STACK_OFFSET_PX = 15;

/** A single slot address on some battlefield (whose battlefield is tracked
 *  separately on the card itself). */
export type BattlefieldSlot = {
  row: number;
  col: number;
};

/** Battlefield grid dimensions computed from container size + card size. */
export type BattlefieldGrid = {
  cols: number;
  rows: number;
};

/**
 * How many card-sized slots (with the fixed gap between them) fit along
 * one axis given the container size. Always returns at least 1 so an
 * absurdly small battlefield still has one slot.
 */
export function slotsAlongAxis(
  containerPx: number,
  cardPx: number,
  gapPx = BATTLEFIELD_GAP_PX,
): number {
  if (containerPx <= 0 || cardPx <= 0) return 0;
  // Fit N cards + (N-1) gaps into containerPx.  Solve for N: containerPx = N*card + (N-1)*gap  →  N = (containerPx + gap) / (card + gap)
  return Math.max(1, Math.floor((containerPx + gapPx) / (cardPx + gapPx)));
}

/** Compute (cols, rows) that fit in a container. Returns {0,0} if unmeasured. */
export function fitBattlefieldGrid(
  containerWidthPx: number,
  containerHeightPx: number,
  cardWidthPx: number,
  cardHeightPx: number,
  gapPx = BATTLEFIELD_GAP_PX,
): BattlefieldGrid {
  return {
    cols: slotsAlongAxis(containerWidthPx, cardWidthPx, gapPx),
    rows: slotsAlongAxis(containerHeightPx, cardHeightPx, gapPx),
  };
}

/**
 * Snap fractional coordinates within a battlefield (0..1 in both axes) to
 * the nearest grid slot given the current grid dimensions.
 */
export function snapToSlot(
  fx: number,
  fy: number,
  grid: BattlefieldGrid,
): BattlefieldSlot {
  const cols = Math.max(1, grid.cols);
  const rows = Math.max(1, grid.rows);
  return {
    col: clampInt(Math.round(fx * (cols - 1)), 0, cols - 1),
    row: clampInt(Math.round(fy * (rows - 1)), 0, rows - 1),
  };
}

/**
 * Convert a slot into a fraction 0..1 along each axis representing where
 * the card's top-left corner should sit within the usable (container minus
 * one card size) area. Rendering layer multiplies by `container - card` to
 * get absolute px.
 */
export function slotFraction(
  slot: BattlefieldSlot,
  grid: BattlefieldGrid,
): { fx: number; fy: number } {
  const cols = Math.max(1, grid.cols);
  const rows = Math.max(1, grid.rows);
  return {
    fx: cols === 1 ? 0 : slot.col / (cols - 1),
    fy: rows === 1 ? 0 : slot.row / (rows - 1),
  };
}

/** Whether two slots refer to the same cell. */
export function sameSlot(a: BattlefieldSlot, b: BattlefieldSlot): boolean {
  return a.row === b.row && a.col === b.col;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
