-- Rooms + membership schema. Run in Supabase → SQL Editor.
-- Idempotent (uses `if not exists`, `create or replace`, `drop if exists`).

-- ------------------------------------------------------------------
-- rooms
-- ------------------------------------------------------------------
create table if not exists public.rooms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 3 and 60),
  host_id         uuid not null references public.profiles(id) on delete cascade,
  format          text not null check (format in
                    ('Commander', 'Legacy', 'Modern', 'Standard', 'Pauper', 'Cube', 'Other')),
  capacity        int not null check (capacity between 2 and 8),
  current_players int not null default 0,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

comment on table public.rooms is
  'Lobby entries for game rooms. Rooms auto-close (closed_at is set) when the last member leaves.';

create index if not exists rooms_open_idx on public.rooms (created_at desc) where closed_at is null;

alter table public.rooms enable row level security;

drop policy if exists "rooms readable by authenticated"          on public.rooms;
drop policy if exists "authenticated can create rooms as self"   on public.rooms;
drop policy if exists "host can update own room"                 on public.rooms;
drop policy if exists "host can delete own room"                 on public.rooms;

create policy "rooms readable by authenticated"
  on public.rooms for select
  to authenticated using (true);

create policy "authenticated can create rooms as self"
  on public.rooms for insert
  to authenticated
  with check (host_id = auth.uid());

create policy "host can update own room"
  on public.rooms for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy "host can delete own room"
  on public.rooms for delete
  to authenticated
  using (host_id = auth.uid());

-- ------------------------------------------------------------------
-- room_members
-- ------------------------------------------------------------------
create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  seat      text not null default 'player' check (seat in ('host', 'player', 'spectator')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);

alter table public.room_members enable row level security;

drop policy if exists "room members readable by authenticated" on public.room_members;
drop policy if exists "users insert self into rooms"           on public.room_members;
drop policy if exists "users delete own membership"            on public.room_members;

create policy "room members readable by authenticated"
  on public.room_members for select
  to authenticated using (true);

create policy "users insert self into rooms"
  on public.room_members for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users delete own membership"
  on public.room_members for delete
  to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------------
-- Trigger: on room INSERT, add the host as a member with seat='host'.
-- Runs with SECURITY DEFINER so it can bypass the "insert self" RLS
-- policy (the host row is added on their behalf by the system).
-- ------------------------------------------------------------------
create or replace function public.add_host_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.room_members (room_id, user_id, seat)
  values (new.id, new.host_id, 'host')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_room_created on public.rooms;
create trigger on_room_created
  after insert on public.rooms
  for each row execute procedure public.add_host_membership();

-- ------------------------------------------------------------------
-- Trigger: keep rooms.current_players in sync with room_members, and
-- auto-close the room when the last member leaves.
-- ------------------------------------------------------------------
create or replace function public.on_room_member_change()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    update public.rooms
       set current_players = current_players + 1
     where id = new.room_id;
  elsif TG_OP = 'DELETE' then
    update public.rooms
       set current_players = greatest(current_players - 1, 0),
           closed_at = case
             when current_players - 1 <= 0 and closed_at is null then now()
             else closed_at
           end
     where id = old.room_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_room_members_change on public.room_members;
create trigger on_room_members_change
  after insert or delete on public.room_members
  for each row execute procedure public.on_room_member_change();

-- ------------------------------------------------------------------
-- Enable Realtime broadcasts for these tables so clients get
-- INSERT/UPDATE/DELETE notifications.
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;
end
$$;
