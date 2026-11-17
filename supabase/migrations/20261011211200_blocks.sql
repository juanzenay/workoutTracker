-- Blocks (a split of sessions with exercise picks, rep ranges and a length)
-- and the dated planned sessions the engine generates from them. Planned
-- sessions are engine output persisted by the command layer (replanBlocks):
-- one row per (block session, date), so ids stay stable across re-plans.

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  start_date date not null,
  weeks integer not null check (weeks between 1 and 52),
  -- IANA zone the block's dates (and the dates of workouts it reads) are in.
  time_zone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.block_sessions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.blocks (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  -- ISO weekday: 1 = Monday … 7 = Sunday.
  weekday smallint not null check (weekday between 1 and 7),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);

create index block_sessions_block_idx on public.block_sessions (block_id, position);

create table public.block_exercises (
  id uuid primary key default gen_random_uuid(),
  block_session_id uuid not null references public.block_sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position integer not null check (position >= 0),
  sets integer not null check (sets between 1 and 20),
  rep_range_start integer not null check (rep_range_start between 1 and 100),
  rep_range_end integer not null check (rep_range_end >= rep_range_start and rep_range_end <= 100),
  -- Load for the first session when there is no history; as entered, with unit.
  start_weight numeric check (start_weight is null or start_weight >= 0),
  unit public.weight_unit not null default 'lb',
  increment numeric not null check (increment > 0),
  rule text not null default 'double' check (rule in ('double')),
  created_at timestamptz not null default now()
);

create index block_exercises_session_idx on public.block_exercises (block_session_id, position);

create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.blocks (id) on delete cascade,
  block_session_id uuid not null references public.block_sessions (id) on delete cascade,
  date date not null,
  week integer not null check (week >= 1),
  name text not null,
  -- PlannedExercise[] (src/domain/block.ts): targets + progression decision and reason.
  exercises jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_session_id, date)
);

create index planned_sessions_date_idx on public.planned_sessions (date);

alter table public.blocks enable row level security;
alter table public.block_sessions enable row level security;
alter table public.block_exercises enable row level security;
alter table public.planned_sessions enable row level security;

create policy "owner manages blocks" on public.blocks
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages block_sessions" on public.block_sessions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages block_exercises" on public.block_exercises
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages planned_sessions" on public.planned_sessions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
