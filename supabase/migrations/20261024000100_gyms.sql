-- Gyms: where a workout is done. A machine belongs to a gym (the same exercise has different machines at
-- different gyms), and a workout names the gym it was done at, so the logger shows only that gym's machines
-- and new workouts start at the gym used last. Both links are nullable and unset for everything that exists
-- today: machines made before gyms stay under "no gym".

create table public.gyms (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create unique index gyms_name_idx on public.gyms (lower(btrim(name)));

alter table public.machines add column gym_id uuid references public.gyms (id) on delete cascade;
alter table public.workouts add column gym_id uuid references public.gyms (id) on delete set null;

-- A machine's name is unique per exercise and gym (machines with no gym share one namespace), ignoring case.
drop index public.machines_exercise_name_idx;
create unique index machines_exercise_gym_name_idx
  on public.machines (exercise_id, coalesce(gym_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index machines_gym_idx on public.machines (gym_id) where gym_id is not null;

alter table public.gyms enable row level security;

create policy "owner manages gyms" on public.gyms
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
