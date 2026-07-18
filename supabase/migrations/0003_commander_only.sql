-- Restrict rooms.format to 'Commander' only. Idempotent.
-- If/when other formats are supported again, drop this constraint and add
-- back the multi-value one from 0002_rooms.sql.

-- Any rooms that were created with other formats (from testing 0002) are
-- deleted here so the new constraint can apply cleanly. Safe: rooms are
-- ephemeral lobby entries; there's nothing worth preserving.
delete from public.rooms where format <> 'Commander';

alter table public.rooms drop constraint if exists rooms_format_check;
alter table public.rooms add constraint rooms_format_check check (format = 'Commander');
alter table public.rooms alter column format set default 'Commander';
