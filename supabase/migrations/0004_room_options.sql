-- Add privacy (public/private + password) and bracket cap to rooms.
-- Route room creation and joining through security-definer RPCs so passwords
-- can be bcrypt-hashed server-side and never touch the client (or a plaintext
-- column) at rest.
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Columns
-- ------------------------------------------------------------------
alter table public.rooms
  add column if not exists is_public   boolean not null default true,
  add column if not exists password_hash text,
  add column if not exists max_bracket int not null default 5
    check (max_bracket between 1 and 5);

comment on column public.rooms.password_hash is
  'bcrypt hash of the room password. NULL for public rooms. Never expose plaintext to the client.';
comment on column public.rooms.max_bracket is
  'Max Commander bracket allowed in this room (1=Exhibition, 2=Core, 3=Upgraded, 4=Optimized, 5=cEDH). Aspirational, not enforced against decks yet.';

-- ------------------------------------------------------------------
-- Replace the room SELECT policy so private rooms are hidden from
-- non-members. Host + members can always see; the public sees is_public rooms.
-- ------------------------------------------------------------------
drop policy if exists "rooms readable by authenticated" on public.rooms;
drop policy if exists "rooms visible to public or members" on public.rooms;

create policy "rooms visible to public or members"
  on public.rooms for select
  to authenticated
  using (
    is_public = true
    or host_id = auth.uid()
    or exists (
      select 1 from public.room_members
       where room_members.room_id = rooms.id
         and room_members.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- Route creation + join through RPCs. Drop the direct INSERT policy on
-- rooms so clients can't create rooms without going through create_room
-- (which enforces host_id = auth.uid() and hashes the password).
-- ------------------------------------------------------------------
drop policy if exists "authenticated can create rooms as self" on public.rooms;

-- Same rationale for room_members: joining a private room must verify the
-- password, so we require the RPC path. Users can still LEAVE directly
-- (delete policy stays).
drop policy if exists "users insert self into rooms" on public.room_members;

-- ------------------------------------------------------------------
-- create_room RPC — hashes password (if provided), inserts row, returns it.
-- ------------------------------------------------------------------
create or replace function public.create_room(
  p_name        text,
  p_capacity    int,
  p_is_public   boolean,
  p_password    text,
  p_max_bracket int
) returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not p_is_public then
    if p_password is null or length(p_password) < 1 then
      raise exception 'Private rooms require a password' using errcode = '22023';
    end if;
    v_hash := crypt(p_password, gen_salt('bf'));
  else
    v_hash := null;
  end if;

  insert into public.rooms
    (name, host_id, format, capacity, is_public, password_hash, max_bracket)
  values
    (p_name, auth.uid(), 'Commander', p_capacity, p_is_public, v_hash, p_max_bracket)
  returning * into v_room;

  return v_room;
end;
$$;

grant execute on function public.create_room(text, int, boolean, text, int) to authenticated;

-- ------------------------------------------------------------------
-- join_room RPC — verifies password for private rooms, then inserts membership.
-- Bypasses RLS via security definer; still respects capacity + open state.
-- ------------------------------------------------------------------
create or replace function public.join_room(
  p_room_id  uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  if not found then
    raise exception 'Room not found' using errcode = '42704';
  end if;

  if v_room.closed_at is not null then
    raise exception 'Room is closed' using errcode = '54000';
  end if;

  -- Already a member? No-op success.
  if exists (
    select 1 from public.room_members
     where room_id = p_room_id and user_id = auth.uid()
  ) then
    return;
  end if;

  if v_room.current_players >= v_room.capacity then
    raise exception 'Room is full' using errcode = '54000';
  end if;

  if not v_room.is_public then
    if v_room.password_hash is null then
      raise exception 'Private room has no password set' using errcode = '28000';
    end if;
    if p_password is null
       or crypt(p_password, v_room.password_hash) <> v_room.password_hash then
      raise exception 'Incorrect password' using errcode = '28P01';
    end if;
  end if;

  insert into public.room_members (room_id, user_id, seat)
  values (p_room_id, auth.uid(), 'player');
end;
$$;

grant execute on function public.join_room(uuid, text) to authenticated;
