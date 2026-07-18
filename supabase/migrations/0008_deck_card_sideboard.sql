-- Add 'sideboard' as a valid value for deck_cards.category.
-- Commander doesn't have a traditional sideboard, but Moxfield-style
-- "considerations" that live outside the 99-card main deck are useful
-- for playtest scratch and card evaluation.
--
-- Idempotent: safe to re-run.

alter table public.deck_cards
  drop constraint if exists deck_cards_category_check;

alter table public.deck_cards
  add constraint deck_cards_category_check
  check (category in ('main', 'commander', 'sideboard'));
