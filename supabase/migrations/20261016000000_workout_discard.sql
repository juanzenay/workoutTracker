-- A discarded workout is archived, not deleted: `discarded_at` marks it. It keeps its
-- finished_at (null if it was discarded mid-session) so restoring brings it back as it was.
-- Everything that reads workouts as history/stats filters on `discarded_at is null`.
-- Nullable and unset for every existing row, so nothing changes for them.

alter table public.workouts add column discarded_at timestamptz;

create index workouts_discarded_at_idx on public.workouts (discarded_at desc) where discarded_at is not null;
