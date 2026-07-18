-- Game start: host transitions the room from "deck selection" to "in game".
-- Two paths:
--   1. Normal start — requires every member to have readied up.
--   2. Force start — host can start regardless of ready state; members without
--      a selected deck at that moment are marked as spectators for the game
--      (is_playing=false) rather than being kicked.
--
-- After start, room_members.is_playing captures the "who's actually in this
-- game" set, snapshotted so it doesn't shift if someone changes their deck
-- mid-match.

alter table public.rooms
  add column if not exists started_at timestamptz;

alter table public.room_members
  add column if not exists is_playing boolean not null default false;

comment on column public.rooms.started_at is
  'Timestamp the host started the game. Null while still in deck-selection phase.';
comment on column public.room_members.is_playing is
  'Snapshot at game start: true if the member had a selected deck. False = spectator for this game. Not touched after start.';

-- ------------------------------------------------------------------
-- start_game(p_room_id, p_force):
--   - host-only
--   - refuses if no members have a deck selected (nothing to play)
--   - if p_force = false: requires every member to be readied
--   - marks members with selected_deck_id as is_playing=true, others false
--   - stamps rooms.started_at = now()
--   - idempotent-ish: re-calling on an already-started room is a no-op error
--     (avoids double-firing side effects the caller doesn't expect)
-- ------------------------------------------------------------------
create or replace function public.start_game(
  p_room_id uuid,
  p_force boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_started timestamptz;
  v_players_with_deck int;
  v_unready int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select host_id, started_at into v_host, v_started
    from public.rooms
   where id = p_room_id and closed_at is null;
  if v_host is null then
    raise exception 'room does not exist or is closed';
  end if;

  if v_host <> v_uid then
    raise exception 'only the host can start the game';
  end if;

  if v_started is not null then
    raise exception 'game has already started';
  end if;

  select count(*) into v_players_with_deck
    from public.room_members
   where room_id = p_room_id and selected_deck_id is not null;

  if v_players_with_deck < 1 then
    raise exception 'at least one player needs a selected deck to start';
  end if;

  if not p_force then
    select count(*) into v_unready
      from public.room_members
     where room_id = p_room_id and ready_at is null;
    if v_unready > 0 then
      raise exception 'not all players are ready — use force start to override';
    end if;
  end if;

  update public.room_members
     set is_playing = (selected_deck_id is not null)
   where room_id = p_room_id;

  update public.rooms
     set started_at = now()
   where id = p_room_id;
end;
$$;

comment on function public.start_game(uuid, boolean) is
  'Host-only. Transition the room from deck-selection to in-game. Force-start allows the game to begin even when not all players are ready; members without a selected deck become spectators for this game.';

grant execute on function public.start_game(uuid, boolean) to authenticated;
