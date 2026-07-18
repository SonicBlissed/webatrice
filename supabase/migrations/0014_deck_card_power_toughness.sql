-- ---------------------------------------------------------------------------
-- Cache power/toughness on deck_cards.
--
-- Scryfall returns these as strings — most cards use numeric strings ("2"),
-- but creatures with variable stats use "*", "1+*", "2+*", and vehicles/CDH
-- can have "?". Storing as text preserves whatever Scryfall said and lets
-- future features (library sort by P/T, mana curve breakdowns weighted by
-- creature stats, combat math helpers) render the exact string a player
-- would see on the card. Non-creatures leave both columns NULL.
--
-- Backfill happens naturally: next time each card is touched (edited,
-- swapped printing, or re-imported), the ingest paths overwrite these
-- fields from the Scryfall response. There is no migration-time backfill
-- because we don't want to hammer the Scryfall API from the DB.
-- ---------------------------------------------------------------------------

alter table public.deck_cards
  add column if not exists power     text,
  add column if not exists toughness text;

comment on column public.deck_cards.power is
  'Scryfall power field, cached at ingest time. Nullable for non-creatures.';
comment on column public.deck_cards.toughness is
  'Scryfall toughness field, cached at ingest time. Nullable for non-creatures.';
