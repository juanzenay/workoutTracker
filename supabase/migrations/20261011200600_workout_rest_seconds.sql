-- Per-exercise rest timer duration (seconds) chosen in the logger. Null = the app default.
-- The running timer itself (its absolute end time) is device-local and never synced.

alter table public.workout_exercises
  add column rest_seconds integer check (rest_seconds is null or rest_seconds between 0 and 3600);
