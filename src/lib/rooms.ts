import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "./supabase";

// Only Commander is supported for now. When/if other formats return, expand
// this list AND the `rooms.format` CHECK constraint (see migration 0003).
export const ROOM_FORMATS = ["Commander"] as const;

export type RoomFormat = (typeof ROOM_FORMATS)[number];

export type Seat = "host" | "player" | "spectator";

/**
 * Commander bracket 1–5. Higher = more competitive. The room's `max_bracket`
 * is the ceiling a host wants at their table — aspirational only, not
 * enforced against decks yet (deck bracket assessment lands later).
 */
export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKET_LABELS: Record<Bracket, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

export type Room = {
  id: string;
  name: string;
  host_id: string;
  format: RoomFormat;
  capacity: number;
  current_players: number;
  is_public: boolean;
  max_bracket: Bracket;
  created_at: string;
  closed_at: string | null;
  started_at: string | null;
  // password_hash exists on the DB row but is intentionally omitted from the
  // client type — nothing in the UI should ever read it.
};

export type RoomMember = {
  room_id: string;
  user_id: string;
  seat: Seat;
  joined_at: string;
  selected_deck_id: string | null;
  selected_bracket: number | null;
  ready_at: string | null;
  is_playing: boolean;
};

export type RoomMemberWithProfile = RoomMember & {
  profile: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    role: "user" | "mod" | "admin";
  } | null;
  selected_deck: {
    id: string;
    name: string;
    bracket: number | null;
  } | null;
};

/**
 * Zod schema for the create-room form. Matches the Postgres CHECK constraints
 * and the create_room RPC's argument shape. If is_public is false, password
 * is required and non-empty (server also enforces).
 */
export const createRoomSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Room name must be at least 3 characters")
      .max(60, "Room name must be at most 60 characters"),
    capacity: z
      .number({ error: "Pick a seat count" })
      .int()
      .min(1, "Seats must be between 1 and 8")
      .max(8, "Seats must be between 1 and 8"),
    is_public: z.boolean(),
    password: z.string().max(60, "Password must be at most 60 characters").optional().or(z.literal("")),
    max_bracket: z
      .number({ error: "Pick a max bracket" })
      .int()
      .min(1, "Max bracket must be between 1 and 5")
      .max(5, "Max bracket must be between 1 and 5"),
  })
  .refine((v) => v.is_public || (v.password && v.password.length >= 1), {
    message: "Please enter a password for the private room",
    path: ["password"],
  });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * Live list of open rooms. Refetches on any change to `rooms` — new rooms
 * appearing, member-count changes, and rooms closing.
 */
export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    // Oldest first — rooms that have been waiting longest surface at the top.
    // RLS ensures we only see public rooms + our own memberships/hosted rooms.
    const { data, error } = await supabase
      .from("rooms")
      .select("id, name, host_id, format, capacity, current_players, is_public, max_bracket, created_at, closed_at, started_at")
      .is("closed_at", null)
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      setRooms([]);
    } else {
      setError(null);
      setRooms((data ?? []) as Room[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
    const channel = supabase
      .channel("rooms-lobby")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms" },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  return { rooms, loading, error, refetch };
}

/**
 * Live info for a single room + its members. Used by GameRoom.
 * Returns `null` room when it has been closed or doesn't exist.
 */
export function useRoom(roomId: string | undefined) {
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!roomId) return;
    const [roomRes, membersRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, name, host_id, format, capacity, current_players, is_public, max_bracket, created_at, closed_at, started_at")
        .eq("id", roomId)
        .maybeSingle(),
      supabase
        .from("room_members")
        .select(
          "*, profile:profiles(id, display_name, username, avatar_url, role), selected_deck:decks(id, name, bracket)",
        )
        .eq("room_id", roomId)
        .order("joined_at"),
    ]);
    if (roomRes.error) setError(roomRes.error.message);
    else if (membersRes.error) setError(membersRes.error.message);
    else {
      setError(null);
      setRoom((roomRes.data as Room | null) ?? null);
      setMembers((membersRes.data ?? []) as RoomMemberWithProfile[]);
    }
    setLoading(false);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    void refetch();
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => void refetch(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, refetch]);

  return { room, members, loading, error, refetch };
}

/**
 * List the rooms the given user is currently a member of and that are still
 * open. Used on app boot to restore game tabs after a refresh / power outage /
 * accidental tab close.
 */
export async function fetchMyActiveRooms(
  userId: string,
): Promise<{ roomId: string; name: string }[]> {
  const { data, error } = await supabase
    .from("room_members")
    .select("room_id, room:rooms!inner(id, name, closed_at)")
    .eq("user_id", userId)
    .is("room.closed_at", null);
  if (error) throw error;
  return (data ?? []).map((m: { room_id: string; room: { name: string } | { name: string }[] }) => {
    const room = Array.isArray(m.room) ? m.room[0] : m.room;
    return { roomId: m.room_id, name: room?.name ?? "Room" };
  });
}

/**
 * Create a room via the `create_room` RPC. The server hashes the password
 * (bcrypt via pgcrypto) when the room is private; nothing plaintext is stored.
 */
export async function createRoom(input: CreateRoomInput): Promise<Room> {
  const { data, error } = await supabase.rpc("create_room", {
    p_name: input.name.trim(),
    p_capacity: input.capacity,
    p_is_public: input.is_public,
    p_password: input.password ?? null,
    p_max_bracket: input.max_bracket,
  });
  if (error) throw error;
  return data as Room;
}

/**
 * Join a room via the `join_room` RPC. Pass `password` for private rooms.
 * Server verifies against the bcrypt hash and raises a clear error on mismatch.
 * Already-a-member is treated as a successful no-op.
 */
export async function joinRoom(roomId: string, password?: string): Promise<void> {
  const { error } = await supabase.rpc("join_room", {
    p_room_id: roomId,
    p_password: password ?? null,
  });
  if (error) throw error;
}

/** Remove current user from the room. Triggers auto-close if this empties the room. */
export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Pick a deck + set ready state atomically. Server enforces:
 *   - membership
 *   - deck ownership
 *   - deck has an assessed bracket
 *   - deck bracket <= room.max_bracket
 * Passing a different deck than the one already selected automatically clears
 * ready (see reset_ready_on_deck_change trigger).
 */
export async function setRoomDeckReady(
  roomId: string,
  deckId: string,
  ready: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_room_deck_ready", {
    p_room_id: roomId,
    p_deck_id: deckId,
    p_ready: ready,
  });
  if (error) throw error;
}

/**
 * Host-only. Transition the room from deck-selection to in-game. `force=true`
 * lets the host start even if not every player has readied — members without
 * a selected deck at that moment are recorded as spectators for this game.
 */
export async function startGame(roomId: string, force: boolean): Promise<void> {
  const { error } = await supabase.rpc("start_game", {
    p_room_id: roomId,
    p_force: force,
  });
  if (error) throw error;
}
