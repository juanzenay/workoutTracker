-- Exercises: the bundled catalogue (free-exercise-db), wger additions, custom
-- exercises and Hevy imports, in one table so history can reference any of them.

create type public.exercise_source as enum ('free-exercise-db', 'wger', 'custom', 'hevy');

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  source public.exercise_source not null,
  -- Identifier in the source system (free-exercise-db id, wger id); null for custom.
  source_ref text,
  hevy_template_id text unique,
  name text not null check (length(btrim(name)) between 1 and 120),
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text,
  category text not null default 'strength',
  force text,
  level text,
  mechanic text,
  instructions text[] not null default '{}',
  -- Relative to the catalogue image base (see src/domain/catalogue.ts), or absolute URLs.
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_ref)
);

create index exercises_name_idx on public.exercises (lower(name));

alter table public.exercises enable row level security;

create policy "owner manages exercises" on public.exercises
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
