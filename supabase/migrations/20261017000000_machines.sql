-- Machines: sub-exercises that keep their own history. The weight for an exercise can differ
-- between machines, so a workout exercise may name the machine it was done on; "Previous" then
-- follows the machine. Ids are generated on the client (like the rest of the logger), so a
-- replayed outbox cannot duplicate one. Names are unique per exercise, ignoring case.
-- A workout exercise's machine is nullable and unset for every existing row, so nothing changes for them.

create table public.machines (
  id uuid primary key,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create unique index machines_exercise_name_idx on public.machines (exercise_id, lower(btrim(name)));

alter table public.workout_exercises
  add column machine_id uuid references public.machines (id) on delete set null;

create index workout_exercises_machine_idx on public.workout_exercises (machine_id) where machine_id is not null;

alter table public.machines enable row level security;

create policy "owner manages machines" on public.machines
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
