-- Persist deck price + bracket alongside the deck row so MyDecks can show
-- them without live-computing on load. Written by the editor after every
-- card change, and by the "Refresh" button in MyDecks. Both may drift as
-- Scryfall prices move; the refresh path is the escape hatch.

alter table public.decks
  add column if not exists total_price_usd numeric,
  add column if not exists total_price_missing_count int not null default 0;

comment on column public.decks.total_price_usd is
  'Sum of TCGplayer USD (usd × qty) across every row of this deck at last assessment. Nullable if never assessed. Reflects the printings actually chosen in the deck.';
comment on column public.decks.total_price_missing_count is
  'How many cards (by quantity) had no TCGplayer USD at last assessment. Used to show a "*" caveat next to the price.';
comment on column public.decks.bracket_assessed_at is
  'When bracket + total_price_usd were last computed. Compare to updated_at or "now" to hint at staleness.';
