-- Two-part reversal of 0004:
--   1. Private rooms are visible in the lobby (only the join is password-gated).
--   2. Move the bcrypt password_hash off the public.rooms row into its own
--      table with strict RLS so it can't be scraped via the API.
--
-- The RPC surface (create_room, join_room) stays identical; only the storage
-- location changes.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------------------
-- 1. Relaxed room SELECT policy — any authenticated user sees any open room.
-- ------------------------------------------------------------------
drop policy if exists "rooms visible to public or members" on public.rooms;
drop policy if exists "rooms readable by authenticated" on public.rooms;

create policy "rooms readable by authenticated"
  on public.rooms for select
  to authenticated
  using (true);

-- ------------------------------------------------------------------
-- 2. Isolated password table. RLS is enabled but no policies are granted,
--    so authenticated clients can neither SELECT nor INSERT — the RPCs
--    (SECURITY DEFINER) are the only path to read/write.
-- ------------------------------------------------------------------
create table if not exists public.room_passwords (
  room_id       uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

comment on table public.room_passwords is
  'One row per private room. Isolated from public.rooms so clients cannot scrape hashes.';

alter table public.room_passwords enable row level security;

-- Explicitly deny direct client access. RLS-enabled tables with no policies
-- already deny by default; this is belt-and-suspenders + documentation.
drop policy if exists "no client access" on public.room_passwords;
create policy "no client access"
  on public.room_passwords for all
  to authenticated
  using (false)
  with check (false);

-- Backfill: move any hashes from the old column into the new table before
-- dropping. Wrapped in a DO block that first checks whether the column still
-- exists, so re-runs (where password_hash has already been dropped) skip the
-- SELECT rather than fail to parse it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'rooms'
       and column_name  = 'password_hash'
  ) then
    execute $mig$
      insert into public.room_passwords (room_id, password_hash)
      select id, password_hash from public.rooms where password_hash is not null
      on conflict (room_id) do nothing
    $mig$;
  end if;
end
$$;

alter table public.rooms drop column if exists password_hash;

-- ------------------------------------------------------------------
-- Replace create_room to write to room_passwords.
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
set search_path = public, extensions
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not p_is_public then
    if p_password is null or length(p_password) < 1 then
      raise exception 'Private rooms require a password' using errcode = '22023';
    end if;
  end if;

  insert into public.rooms
    (name, host_id, format, capacity, is_public, max_bracket)
  values
    (p_name, auth.uid(), 'Commander', p_capacity, p_is_public, p_max_bracket)
  returning * into v_room;

  if not p_is_public then
    insert into public.room_passwords (room_id, password_hash)
    values (v_room.id, crypt(p_password, gen_salt('bf')));
  end if;

  return v_room;
end;
$$;

grant execute on function public.create_room(text, int, boolean, text, int) to authenticated;

-- ------------------------------------------------------------------
-- Replace join_room to read from room_passwords.
-- ------------------------------------------------------------------
create or replace function public.join_room(
  p_room_id  uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room       public.rooms;
  v_hash       text;
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

  -- Already a member? No-op success — this is what makes reconnection /
  -- clicking your own room from the lobby always work regardless of password.
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
    select password_hash into v_hash
      from public.room_passwords
     where room_id = p_room_id;
    if v_hash is null then
      raise exception 'Private room has no password set' using errcode = '28000';
    end if;
    if p_password is null
       or crypt(p_password, v_hash) <> v_hash then
      raise exception 'Incorrect password' using errcode = '28P01';
    end if;
  end if;

  insert into public.room_members (room_id, user_id, seat)
  values (p_room_id, auth.uid(), 'player');
end;
$$;

grant execute on function public.join_room(uuid, text) to authenticated;
