-- Pin the specific printing chosen by the deck-builder onto each deck_cards
-- row. `card_scryfall_id` already uniquely identifies the printing on
-- Scryfall's side, but caching the set + collector number here lets the UI
-- display "Sol Ring (2XM) #300" without an extra API roundtrip and makes
-- multiplayer render the same art the deck-builder picked.
--
-- Backwards compatible: existing rows keep NULL, which the client treats as
-- "printing info unknown" and renders using card_scryfall_id / image_uri.

alter table public.deck_cards
  add column if not exists set              text,
  add column if not exists collector_number text;

comment on column public.deck_cards.set is
  'Scryfall set code of the chosen printing (lowercase, e.g. ''2xm''). NULL for rows created before this migration.';
comment on column public.deck_cards.collector_number is
  'Scryfall collector number of the chosen printing (may be alphanumeric).';
