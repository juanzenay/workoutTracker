-- Hevy import (re-runnable until cutover). Everything is keyed on Hevy's own
-- ids so a re-run updates instead of duplicating: workouts on the Hevy workout
-- id, exercises on the Hevy exercise-template id.

-- Imported workouts remember where they came from and which Hevy revision we hold.
alter table public.workouts
  add column hevy_workout_id text unique,
  add column hevy_updated_at timestamptz;

-- Hevy duration/distance sets (cardio, planks, carries). Distances in meters.
alter table public.workout_sets
  add column duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  add column distance_meters numeric check (distance_meters is null or distance_meters >= 0);

-- The owner's Hevy API key (Hevy Pro) and the last import's outcome. One row at most.
create table public.hevy_connection (
  id boolean primary key default true check (id),
  api_key text not null,
  last_imported_at timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

-- How each Hevy exercise template maps onto a workout tracker exercise:
--   matched   auto-matched to a catalogue exercise (certain)
--   review    uncertain; history sits on a placeholder `hevy` exercise until the owner decides
--   confirmed the owner decided (catalogue exercise or keep the placeholder)
--   custom    no catalogue match, or a Hevy custom exercise: a `hevy` exercise
-- Once a row exists the importer never re-matches it, so decisions survive re-runs.
create type public.hevy_match_status as enum ('matched', 'review', 'confirmed', 'custom');

create table public.hevy_exercise_matches (
  hevy_template_id text primary key,
  hevy_title text not null,
  exercise_id uuid not null references public.exercises (id),
  status public.hevy_match_status not null,
  -- Catalogue suggestions for a `review`, best first.
  candidate_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hevy_exercise_matches_review_idx on public.hevy_exercise_matches (status) where status = 'review';

alter table public.hevy_connection enable row level security;
alter table public.hevy_exercise_matches enable row level security;

create policy "owner manages hevy_connection" on public.hevy_connection
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages hevy_exercise_matches" on public.hevy_exercise_matches
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
