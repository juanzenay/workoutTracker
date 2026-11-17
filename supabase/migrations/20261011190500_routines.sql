-- Routines (templates for a workout: exercises with target sets) and the
-- folders that keep current and archived splits apart. hevy_* ids are the
-- idempotency keys for the Hevy importer; null for routines made in workout tracker.

create table public.routine_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  position integer not null default 0 check (position >= 0),
  hevy_folder_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  -- Deleting a folder keeps its routines (they become unfiled).
  folder_id uuid references public.routine_folders (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  notes text,
  position integer not null default 0 check (position >= 0),
  hevy_routine_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index routines_folder_idx on public.routines (folder_id, position);

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position integer not null check (position >= 0),
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  superset_group integer,
  notes text,
  created_at timestamptz not null default now()
);

create index routine_exercises_routine_idx on public.routine_exercises (routine_id, position);

create table public.routine_sets (
  id uuid primary key default gen_random_uuid(),
  routine_exercise_id uuid not null references public.routine_exercises (id) on delete cascade,
  position integer not null check (position >= 0),
  set_type public.set_type not null default 'normal',
  -- Target weight as entered, with its unit (never converted).
  weight numeric check (weight is null or weight >= 0),
  unit public.weight_unit not null default 'lb',
  -- Either a fixed rep target or a range (Hevy's rep_range); all optional.
  reps integer check (reps is null or reps >= 0),
  rep_range_start integer check (rep_range_start is null or rep_range_start >= 0),
  rep_range_end integer check (rep_range_end is null or rep_range_end >= rep_range_start),
  created_at timestamptz not null default now()
);

create index routine_sets_exercise_idx on public.routine_sets (routine_exercise_id, position);

alter table public.routine_folders enable row level security;
alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.routine_sets enable row level security;

create policy "owner manages routine_folders" on public.routine_folders
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages routines" on public.routines
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages routine_exercises" on public.routine_exercises
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages routine_sets" on public.routine_sets
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
