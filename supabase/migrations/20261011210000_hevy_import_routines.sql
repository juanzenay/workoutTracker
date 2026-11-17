-- Hevy import, part 2: routines, routine folders and body measurements.
-- Folders and routines are keyed on their Hevy ids (columns from the routines
-- migration); like workouts they remember which Hevy revision we hold, so a
-- re-run only rewrites what changed in Hevy and keeps edits made in workout tracker otherwise.

alter table public.routine_folders add column hevy_updated_at timestamptz;
alter table public.routines add column hevy_updated_at timestamptz;

-- Body measurements are keyed on date. Entries that came from Hevy may be
-- refreshed by a re-run; entries logged (or edited) in workout tracker are never overwritten.
alter table public.body_measurements add column from_hevy boolean not null default false;
