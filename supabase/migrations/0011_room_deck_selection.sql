-- Deck selection + ready state per room member. After joining a room, each
-- player picks a deck (whose bracket must be <= room.max_bracket) and
-- "readies up". Once every player has readied, the host can start the game.
--
-- selected_deck_id  - nullable so we can represent "seated but not yet picked".
--                     ON DELETE SET NULL so deleting a deck doesn't cascade
--                     into evicting the player from their room; they just
--                     have to pick a new deck.
-- selected_bracket  - snapshot of the deck's bracket AT ready time. Persisted
--                     so the badge shown alongside a ready player doesn't
--                     silently shift if they re-assess the deck mid-lobby.
-- ready_at          - null = not ready; timestamp = when they clicked ready.

alter table public.room_members
  add column if not exists selected_deck_id uuid
    references public.decks(id) on delete set null,
  add column if not exists selected_bracket int check (selected_bracket between 1 and 5),
  add column if not exists ready_at timestamptz;

comment on column public.room_members.selected_deck_id is
  'The deck this member has selected for this room. Null until they pick. Cleared automatically if the deck is deleted.';
comment on column public.room_members.selected_bracket is
  'Snapshot of the selected deck bracket AT ready time. Locked in so the badge shown to opponents does not drift if the owner reassesses.';
comment on column public.room_members.ready_at is
  'Set when the member hits Ready; null when they Unready. Cleared automatically whenever selected_deck_id changes (see trigger below).';

-- If a member changes their deck (or has it cleared), they must re-ready.
create or replace function public.reset_ready_on_deck_change()
returns trigger language plpgsql as $$
begin
  if new.selected_deck_id is distinct from old.selected_deck_id then
    new.ready_at := null;
    new.selected_bracket := null;
  end if;
  return new;
end;
$$;

drop trigger if exists room_members_reset_ready on public.room_members;
create trigger room_members_reset_ready
  before update on public.room_members
  for each row execute procedure public.reset_ready_on_deck_change();

-- ------------------------------------------------------------------
-- ready_up RPC: atomic set-deck-and-ready operation with server-side
-- bracket-cap enforcement. Also snapshots the deck's current bracket
-- into selected_bracket so the display doesn't drift.
--
-- We do NOT allow readying without a deck: the deck arg is required.
-- Unready is a separate one-shot: pass p_ready = false.
-- ------------------------------------------------------------------
create or replace function public.set_room_deck_ready(
  p_room_id uuid,
  p_deck_id uuid,
  p_ready boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room_max int;
  v_deck_bracket int;
  v_deck_owner uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Member gate
  if not exists (
    select 1 from public.room_members
     where room_id = p_room_id and user_id = v_uid
  ) then
    raise exception 'you are not a member of this room';
  end if;

  -- Room lookup
  select max_bracket into v_room_max
    from public.rooms where id = p_room_id and closed_at is null;
  if v_room_max is null then
    raise exception 'room does not exist or is closed';
  end if;

  -- Deck ownership + bracket
  select bracket, owner_id
    into v_deck_bracket, v_deck_owner
    from public.decks where id = p_deck_id;
  if v_deck_owner is null then
    raise exception 'deck does not exist';
  end if;
  if v_deck_owner <> v_uid then
    raise exception 'you do not own that deck';
  end if;
  if v_deck_bracket is null then
    raise exception 'deck has not been assessed yet — assess it first';
  end if;
  if v_deck_bracket > v_room_max then
    raise exception 'deck bracket (%) exceeds the room maximum (%)',
      v_deck_bracket, v_room_max;
  end if;

  -- Two-step update because the reset_ready trigger clears ready_at whenever
  -- selected_deck_id changes. First set the deck (which nulls out ready_at),
  -- then apply the ready decision.
  update public.room_members
     set selected_deck_id = p_deck_id
   where room_id = p_room_id and user_id = v_uid;

  update public.room_members
     set ready_at = case when p_ready then now() else null end,
         selected_bracket = case when p_ready then v_deck_bracket else null end
   where room_id = p_room_id and user_id = v_uid;
end;
$$;

comment on function public.set_room_deck_ready(uuid, uuid, boolean) is
  'Pick a deck and set ready state for the current user in the given room. Enforces bracket ceiling and deck ownership. Passing a different deck automatically unreadies. Called from the deck-selection UI.';

grant execute on function public.set_room_deck_ready(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------------
-- Members already have an "update own membership" gap — we haven't
-- allowed self-updates in the original policy. Add it here so the
-- RPC's SECURITY DEFINER isn't the ONLY path; direct row updates
-- (e.g. spectator/seat toggles later) can go through with the same
-- constraint.
-- ------------------------------------------------------------------
drop policy if exists "users update own membership" on public.room_members;
create policy "users update own membership"
  on public.room_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
