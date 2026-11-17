-- Logged workouts. Ids are generated on the client (the logger is local-first),
-- so every write from the outbox can be replayed idempotently by primary key.

create type public.set_type as enum ('normal', 'warmup', 'drop', 'failure');
create type public.weight_unit as enum ('lb', 'kg');

create table public.workouts (
  id uuid primary key,
  name text check (name is null or length(name) <= 120),
  started_at timestamptz not null,
  finished_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workouts_finished_at_idx on public.workouts (finished_at desc) where finished_at is not null;

create table public.workout_exercises (
  id uuid primary key,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position integer not null check (position >= 0),
  superset_group integer,
  notes text,
  created_at timestamptz not null default now()
);

create index workout_exercises_workout_idx on public.workout_exercises (workout_id, position);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id uuid primary key,
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  position integer not null check (position >= 0),
  set_type public.set_type not null default 'normal',
  -- Exactly as entered (numeric keeps 182.5 as 182.5); never converted between units.
  weight numeric check (weight is null or weight >= 0),
  unit public.weight_unit not null,
  reps integer check (reps is null or reps >= 0),
  rir integer check (rir is null or rir between 0 and 3),
  completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_sets_exercise_idx on public.workout_sets (workout_exercise_id, position);

alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

create policy "owner manages workouts" on public.workouts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages workout_exercises" on public.workout_exercises
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages workout_sets" on public.workout_sets
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
