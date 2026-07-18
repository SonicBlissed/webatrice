-- Commander decks + cards. Owner-only for now; sharing/public is a later
-- iteration. Idempotent (create if not exists, drop policy if exists).

-- ------------------------------------------------------------------
-- decks
-- ------------------------------------------------------------------
create table if not exists public.decks (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles(id) on delete cascade,
  name                  text not null default 'Untitled deck' check (char_length(name) between 1 and 80),
  description           text,
  bracket               int check (bracket between 1 and 5),
  bracket_assessed_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.decks is
  'Commander decks. One row per deck. Cards live in deck_cards. Bracket is nullable — assessed on demand, not on every edit.';

create index if not exists decks_owner_idx on public.decks (owner_id, updated_at desc);

alter table public.decks enable row level security;

drop policy if exists "owners see own decks"    on public.decks;
drop policy if exists "owners create own decks" on public.decks;
drop policy if exists "owners update own decks" on public.decks;
drop policy if exists "owners delete own decks" on public.decks;

create policy "owners see own decks"
  on public.decks for select to authenticated using (owner_id = auth.uid());

create policy "owners create own decks"
  on public.decks for insert to authenticated with check (owner_id = auth.uid());

create policy "owners update own decks"
  on public.decks for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owners delete own decks"
  on public.decks for delete to authenticated using (owner_id = auth.uid());

-- Keep updated_at fresh on every deck-level edit (name, description, bracket).
create or replace function public.touch_deck_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists decks_touch_updated_at on public.decks;
create trigger decks_touch_updated_at
  before update on public.decks
  for each row execute procedure public.touch_deck_updated_at();

-- ------------------------------------------------------------------
-- deck_cards
--
-- The commander lives as a row here with category='commander'. Cached
-- name/mana_cost/type_line/colors/image_uri let us render the deck list
-- without hitting Scryfall on every load. They're refreshed when a card
-- is added (via the /cards/collection lookup on import or click-to-add).
-- ------------------------------------------------------------------
create table if not exists public.deck_cards (
  id                uuid primary key default gen_random_uuid(),
  deck_id           uuid not null references public.decks(id) on delete cascade,
  card_scryfall_id  text not null,
  oracle_id         text not null,
  name              text not null,
  mana_cost         text,
  type_line         text,
  cmc               numeric,
  colors            text[] not null default '{}',
  image_uri         text,
  quantity          int not null default 1 check (quantity > 0),
  category          text not null default 'main' check (category in ('main', 'commander')),
  position          int not null default 0,
  created_at        timestamptz not null default now()
);

comment on table public.deck_cards is
  'Cards in a deck. Cached card fields let deck views render without Scryfall roundtrips.';

create index if not exists deck_cards_deck_idx on public.deck_cards (deck_id);
create unique index if not exists deck_cards_unique_per_deck
  on public.deck_cards (deck_id, oracle_id, category);

alter table public.deck_cards enable row level security;

drop policy if exists "cards visible to deck owner"  on public.deck_cards;
drop policy if exists "cards insertable by owner"    on public.deck_cards;
drop policy if exists "cards updatable by owner"     on public.deck_cards;
drop policy if exists "cards deletable by owner"     on public.deck_cards;

-- All four policies gate on the parent deck's owner_id.
create policy "cards visible to deck owner"
  on public.deck_cards for select to authenticated
  using (exists (
    select 1 from public.decks d
     where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
  ));

create policy "cards insertable by owner"
  on public.deck_cards for insert to authenticated
  with check (exists (
    select 1 from public.decks d
     where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
  ));

create policy "cards updatable by owner"
  on public.deck_cards for update to authenticated
  using (exists (
    select 1 from public.decks d
     where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.decks d
     where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
  ));

create policy "cards deletable by owner"
  on public.deck_cards for delete to authenticated
  using (exists (
    select 1 from public.decks d
     where d.id = deck_cards.deck_id and d.owner_id = auth.uid()
  ));

-- Bump the parent deck's updated_at when its cards change so the "recently
-- edited" ordering on MyDecks reflects card edits, not just name edits.
create or replace function public.touch_deck_from_card_change()
returns trigger language plpgsql as $$
begin
  update public.decks set updated_at = now()
   where id = coalesce(new.deck_id, old.deck_id);
  return null;
end;
$$;

drop trigger if exists deck_cards_bump_parent on public.deck_cards;
create trigger deck_cards_bump_parent
  after insert or update or delete on public.deck_cards
  for each row execute procedure public.touch_deck_from_card_change();
