-- Narrow `touch_deck_updated_at` so it only bumps decks.updated_at when the
-- deck's editable content actually changed (name or description). Writes
-- that touch only assessment fields (bracket, total_price_usd, ...) should
-- NOT reorder the deck in MyDecks or lie in its "edited X ago" line —
-- hitting Refresh isn't editing.
--
-- Card-level edits still bump updated_at via touch_deck_from_card_change,
-- which is unchanged.

create or replace function public.touch_deck_updated_at()
returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name
     or new.description is distinct from old.description
  then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
