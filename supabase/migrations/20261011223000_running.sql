-- Races, imported run plans and the dated planned runs the engine anchors
-- from them. Planned runs are engine output persisted by the command layer
-- (replanRuns): one row per (run plan, plan row), so ids stay stable when the
-- race moves and the plan is re-anchored. Distances in meters, durations in
-- seconds, paces in seconds per km.

create table public.races (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  date date not null,
  distance_meters integer not null check (distance_meters > 0),
  priority text not null check (priority in ('A', 'B', 'C')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index races_date_idx on public.races (date);

create table public.run_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  weeks integer not null check (weeks between 1 and 52),
  -- The race whose week is the plan's final week; null = unanchored (race deleted).
  race_id uuid references public.races (id) on delete set null,
  -- IANA zone the plan's dates are in.
  time_zone text not null,
  -- RunPlanRow[] (src/domain/running.ts), as validated at import.
  rows jsonb not null,
  created_at timestamptz not null default now()
);

create table public.planned_runs (
  id uuid primary key default gen_random_uuid(),
  run_plan_id uuid not null references public.run_plans (id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  date date not null,
  week integer not null check (week >= 1),
  type text not null check (type in ('easy', 'long', 'tempo', 'intervals', 'race_pace', 'cross', 'rest', 'race')),
  distance_meters integer check (distance_meters > 0),
  duration_seconds integer check (duration_seconds > 0),
  -- PaceTarget / RunStructure (src/domain/running.ts).
  pace_target jsonb,
  structure jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_plan_id, row_index)
);

create index planned_runs_date_idx on public.planned_runs (date);

alter table public.races enable row level security;
alter table public.run_plans enable row level security;
alter table public.planned_runs enable row level security;

create policy "owner manages races" on public.races
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages run_plans" on public.run_plans
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages planned_runs" on public.planned_runs
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
