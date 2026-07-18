import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RoomMemberWithProfile } from "@/lib/rooms";
import type { DeckCard } from "@/lib/decks";
import { FIRST_PHASE, type Phase } from "@/lib/gamePhases";
import PlayerBox, { type PlayerBoxHandle } from "./PlayerBox";
import BattlefieldSidebar from "./BattlefieldSidebar";
import PhaseTrack from "./PhaseTrack";
import { computeBattlefieldLayout } from "./battlefieldLayout";
import { HoveredCardProvider } from "./hoveredCard";
import { useCardScale, useCardScaleStyle } from "@/lib/cardScale";

/**
 * Fetch every playing member's deck_cards in one query, keyed by user_id.
 * Used to seed each player's zones when the game starts. Refetches when the
 * set of selected deck ids changes.
 */
function usePlayerDeckCards(
  members: RoomMemberWithProfile[],
): Map<string, DeckCard[]> {
  const [cardsByUserId, setCardsByUserId] = useState<Map<string, DeckCard[]>>(
    new Map(),
  );

  const deckKey = useMemo(
    () =>
      members
        .filter((m) => m.is_playing && m.selected_deck_id)
        .map((m) => `${m.user_id}:${m.selected_deck_id}`)
        .sort()
        .join("|"),
    [members],
  );

  useEffect(() => {
    const withDecks = members.filter(
      (m) => m.is_playing && m.selected_deck_id,
    );
    if (withDecks.length === 0) {
      setCardsByUserId(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const deckIds = withDecks.map((m) => m.selected_deck_id!);
      const { data, error } = await supabase
        .from("deck_cards")
        .select("*")
        .in("deck_id", deckIds);
      if (cancelled || error) return;
      const cardsByDeck = new Map<string, DeckCard[]>();
      for (const row of (data ?? []) as DeckCard[]) {
        const list = cardsByDeck.get(row.deck_id) ?? [];
        list.push(row);
        cardsByDeck.set(row.deck_id, list);
      }
      const next = new Map<string, DeckCard[]>();
      for (const m of withDecks) {
        next.set(m.user_id, cardsByDeck.get(m.selected_deck_id!) ?? []);
      }
      setCardsByUserId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckKey]);

  return cardsByUserId;
}

/**
 * Top-level in-game view. Filters members to the actual players (is_playing)
 * and lays them out with the viewer anchored to the bottom-left cell. See
 * battlefieldLayout.ts for the perspective + grid rules.
 *
 * Spectators show up only in the sidebar player list, not on the play area.
 * For 5+ players the play area scrolls horizontally so no box shrinks.
 */
type Props = {
  members: RoomMemberWithProfile[];
  viewerId: string | undefined;
  onLeave: () => void;
  leaving: boolean;
};

// --- MOCK-PLAYERS DEV FLAG -------------------------------------------------
// Append `?mockPlayers=N` (N in 1..8) to the URL to pad the real member list
// with N-1 synthetic seated players. Add `&mockDeck=<uuid>` to also point
// the viewer AND every mock at that specific deck id — lets you test card
// mechanics against a real deck without going through the join-and-ready
// flow first. Purely a dev tool; delete this block (and the call site
// below) when done.
function useMockedMembers(
  real: RoomMemberWithProfile[],
  viewerId: string | undefined,
): RoomMemberWithProfile[] {
  return useMemo(() => {
    if (typeof window === "undefined") return real;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("mockPlayers");
    const mockDeck = params.get("mockDeck");
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 8) return real;

    // If mockDeck is set, patch the viewer (and any other real player) to
    // use that deck so their PlayerBox has cards regardless of the room's
    // actual deck-selection state.
    const patched: RoomMemberWithProfile[] = mockDeck
      ? real.map((m) =>
          m.is_playing
            ? ({
                ...m,
                selected_deck_id: mockDeck,
                selected_deck: {
                  id: mockDeck,
                  name: m.selected_deck?.name ?? "Mock Deck",
                  bracket: m.selected_deck?.bracket ?? 3,
                },
              } as RoomMemberWithProfile)
            : m,
        )
      : real;

    const realPlayers = patched.filter((m) => m.is_playing);
    if (realPlayers.length >= n) return patched;

    const needed = n - realPlayers.length;
    const nonPlayers = patched.filter((m) => !m.is_playing);

    const mocks: RoomMemberWithProfile[] = Array.from({ length: needed }, (_, i) => {
      const idx = realPlayers.length + i;
      // If mockDeck was set, every mock shares that deck so we can preview
      // hands, libraries, etc. Otherwise fall back to a unique fake id so
      // their zones stay empty (current behavior).
      const deckId = mockDeck ?? `mock-deck-${idx}`;
      return {
        room_id: "mock",
        user_id: `mock-${idx}`,
        seat: "player",
        joined_at: new Date(Date.now() + idx).toISOString(),
        selected_deck_id: deckId,
        selected_bracket: (2 + (idx % 3)) as 2 | 3 | 4,
        ready_at: new Date().toISOString(),
        is_playing: true,
        profile: {
          id: `mock-${idx}`,
          display_name: `Player ${idx + 1}`,
          username: `player${idx + 1}`,
          avatar_url: null,
          role: "user",
        },
        selected_deck: {
          id: deckId,
          name: mockDeck ? "Mock Deck" : `Mock Deck ${idx + 1}`,
          bracket: 3,
        },
      } as RoomMemberWithProfile;
    });

    // Real players first (viewer stays anchored to their true seat), then mocks,
    // then any real spectators tacked on the end.
    return [...realPlayers, ...mocks, ...nonPlayers];
    // Re-derive whenever the real member set changes or the URL changes on nav.
  }, [real, viewerId]);
}
// --- end MOCK-PLAYERS DEV FLAG ---------------------------------------------

export default function Battlefield({ members: realMembers, viewerId, onLeave, leaving }: Props) {
  const members = useMockedMembers(realMembers, viewerId);
  const players = useMemo(() => members.filter((m) => m.is_playing), [members]);
  const viewerIndex = viewerId ? players.findIndex((p) => p.user_id === viewerId) : -1;
  const layout = useMemo(
    () => computeBattlefieldLayout(players.length, viewerIndex),
    [players.length, viewerIndex],
  );

  const cardsByUserId = usePlayerDeckCards(members);

  // Registry of PlayerBox imperative handles, keyed by user_id. Any box
  // can route a "gift these cards to that player's battlefield" call
  // through this map without lifting all game state.
  const boxHandles = useRef<Map<string, PlayerBoxHandle>>(new Map());
  const giftCards = useCallback<NonNullable<React.ComponentProps<typeof PlayerBox>["giftCards"]>>(
    (targetPlayerId, cards, intendedSlots) => {
      boxHandles.current.get(targetPlayerId)?.receiveBattlefieldCards(
        cards,
        intendedSlots,
      );
    },
    [],
  );

  // Distribute the viewer's cross-player marquee highlights. `byOwner`
  // maps target playerId → highlighted card ids on their board. Any
  // PlayerBox not present in the map gets an empty set so stale
  // highlights clear cleanly.
  const broadcastBattlefieldSelection = useCallback<
    NonNullable<React.ComponentProps<typeof PlayerBox>["broadcastBattlefieldSelection"]>
  >((byOwner) => {
    boxHandles.current.forEach((h, ownerId) => {
      h.receiveBattlefieldSelection(byOwner.get(ownerId) ?? new Set());
    });
  }, []);

  // Route marquee-start events from opponent PlayerBoxes to the viewer's
  // PlayerBox so its marquee state takes over the interaction. Enables
  // the viewer to select-highlight cards on other players' battlefields
  // even though those PlayerBoxes belong to different players.
  const onMarqueeStart = useCallback<
    NonNullable<React.ComponentProps<typeof PlayerBox>["onMarqueeStart"]>
  >(
    (x, y) => {
      if (!viewerId) return;
      boxHandles.current.get(viewerId)?.startMarquee(x, y);
    },
    [viewerId],
  );

  // Turn + phase state. First player takes the first turn on untap.
  // Pass rotates activePlayerId to the next player and resets to untap.
  // TODO: sync with server-side game state when we wire multiplayer.
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(FIRST_PHASE);
  useEffect(() => {
    if (activePlayerId === null && players.length > 0) {
      setActivePlayerId(players[0].user_id);
    }
  }, [activePlayerId, players]);

  const handlePass = () => {
    if (players.length === 0) return;
    const idx = players.findIndex((p) => p.user_id === activePlayerId);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % players.length;
    setActivePlayerId(players[nextIdx].user_id);
    setPhase(FIRST_PHASE);
  };

  // Each player-box column is at least ~700px wide (scaled by cardScale
  // so a 2x scale doesn't crush battlefields). For 3+ columns the play
  // area gets a horizontal scrollbar rather than crushing individual boxes.
  const { scale } = useCardScale();
  const useScroll = layout.cols >= 3;
  const minColWidth = 700 * scale;
  const gridStyle = {
    display: "grid",
    gap: "0.5rem",
    padding: "0.5rem",
    gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
    gridTemplateColumns: useScroll
      ? `repeat(${layout.cols}, minmax(${minColWidth}px, 1fr))`
      : `repeat(${layout.cols}, minmax(0, 1fr))`,
    minWidth: useScroll ? `${layout.cols * minColWidth}px` : undefined,
    height: "100%",
  } as const;
  const scaleStyle = useCardScaleStyle();

  return (
    <HoveredCardProvider>
    <div className="h-full min-h-0 flex" style={scaleStyle}>
      <PhaseTrack
        currentPhase={phase}
        onPhaseChange={setPhase}
        onPass={handlePass}
        canChangePhase={viewerId !== undefined && viewerId === activePlayerId}
      />
      <div className="flex-1 min-w-0 h-full min-h-0 overflow-auto bg-bg-base/30">
        <div style={gridStyle}>
          {players.map((p, i) => {
            const pos = layout.positions[i];
            if (!pos) return null;
            const viewerPos = viewerIndex >= 0 ? layout.positions[viewerIndex] : null;
            // Players sitting above the viewer's row get their hand on top
            // (their play area is oriented "facing" the viewer). Same-row
            // and below get hand on the bottom, same as the viewer's box.
            const handOnTop = viewerPos ? pos.row < viewerPos.row : false;
            return (
              <div
                key={p.user_id}
                style={{
                  gridRow: pos.row + 1,
                  gridColumn: pos.col + 1,
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                <PlayerBox
                  ref={(h) => {
                    if (h) boxHandles.current.set(p.user_id, h);
                    else boxHandles.current.delete(p.user_id);
                  }}
                  player={p}
                  isSelf={p.user_id === viewerId}
                  isActive={p.user_id === activePlayerId}
                  handOnTop={handOnTop}
                  cards={cardsByUserId.get(p.user_id) ?? []}
                  giftCards={giftCards}
                  broadcastBattlefieldSelection={broadcastBattlefieldSelection}
                  onMarqueeStart={onMarqueeStart}
                />
              </div>
            );
          })}
        </div>
      </div>
      <BattlefieldSidebar members={members} onLeave={onLeave} leaving={leaving} />
    </div>
    </HoveredCardProvider>
  );
}
