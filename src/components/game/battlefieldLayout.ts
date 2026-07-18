/**
 * Compute the on-screen grid position for each player so that the viewer
 * always ends up in the bottom-left cell, and the rest of the players
 * sit CLOCKWISE from there in canonical turn order — the seating you'd
 * expect at a real table.
 *
 * Layouts:
 *   1 player   → 1x1
 *   2 players  → 2 rows × 1 col
 *   3 players  → 3 rows × 1 col
 *   4 players  → 2 rows × 2 cols
 *   5-8 players→ 2 rows × ceil(N/2) cols
 *
 * "Clockwise from the viewer" for a grid means:
 *   bottom-left (viewer) → top-left → top row L→R → bottom-right → bottom row R→L
 * For a single-column list it means going straight up from the viewer.
 *
 * If the viewer isn't a player (spectator watching), we skip the perspective
 * shuffle and just fill positions in canonical player order.
 */

export type CellPosition = { row: number; col: number };

export type BattlefieldLayout = {
  rows: number;
  cols: number;
  /** Maps player index (in the input array's canonical order) → cell position. */
  positions: CellPosition[];
};

/**
 * Ordered list of cells traversed clockwise from the bottom-left, for a
 * two-row grid with the given column count. Length = 2 * cols.
 */
function clockwiseOrderForGrid(cols: number): CellPosition[] {
  const order: CellPosition[] = [];
  order.push({ row: 1, col: 0 });                        // bottom-left (viewer)
  for (let c = 0; c < cols; c++) order.push({ row: 0, col: c });    // top row L→R
  for (let c = cols - 1; c >= 1; c--) order.push({ row: 1, col: c }); // bottom row R→L (skip col 0, already added)
  return order;
}

export function computeBattlefieldLayout(
  playerCount: number,
  viewerIndex: number,
): BattlefieldLayout {
  if (playerCount <= 0) {
    return { rows: 1, cols: 1, positions: [] };
  }

  // Vertical list for small games (1..3). Clockwise from BL just means
  // "going upward" in a single-column stack, so the viewer sits at the
  // bottom row and each next canonical player sits one row above.
  if (playerCount <= 3) {
    const positions: CellPosition[] = [];
    for (let i = 0; i < playerCount; i++) {
      const clockwisePos =
        viewerIndex >= 0
          ? ((i - viewerIndex) % playerCount + playerCount) % playerCount
          : i;
      const row = playerCount - 1 - clockwisePos;
      positions.push({ row, col: 0 });
    }
    return { rows: playerCount, cols: 1, positions };
  }

  // 2-row grid for 4..8 players. Compute the clockwise traversal, then map
  // each canonical player to their offset from the viewer along that traversal.
  const cols = Math.ceil(playerCount / 2);
  const order = clockwiseOrderForGrid(cols);
  const orderLen = order.length; // = 2 * cols; players may be fewer

  const positions: CellPosition[] = [];
  for (let i = 0; i < playerCount; i++) {
    const clockwisePos =
      viewerIndex >= 0
        ? ((i - viewerIndex) % orderLen + orderLen) % orderLen
        : i;
    positions.push(order[clockwisePos]);
  }
  return { rows: 2, cols, positions };
}
