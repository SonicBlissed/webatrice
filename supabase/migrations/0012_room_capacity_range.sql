-- Widen the room capacity range to 1..8 (was 2..8). Enables solo playtesting
-- rooms as well as larger commander pods.

alter table public.rooms
  drop constraint if exists rooms_capacity_check;

alter table public.rooms
  add constraint rooms_capacity_check
  check (capacity between 1 and 8);
