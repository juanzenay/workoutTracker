-- Body measurements: one entry per date with any subset of bodyweight, body
-- composition and girths (fields mirror Hevy's body measurements so imports map
-- 1:1, keyed on date). Values are stored as entered in the entry's units.

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg')),
  length_unit text not null default 'cm' check (length_unit in ('cm', 'in')),
  weight numeric check (weight > 0),
  lean_mass numeric check (lean_mass > 0),
  fat_percent numeric check (fat_percent > 0 and fat_percent < 100),
  neck numeric check (neck > 0),
  shoulders numeric check (shoulders > 0),
  chest numeric check (chest > 0),
  left_bicep numeric check (left_bicep > 0),
  right_bicep numeric check (right_bicep > 0),
  left_forearm numeric check (left_forearm > 0),
  right_forearm numeric check (right_forearm > 0),
  abdomen numeric check (abdomen > 0),
  waist numeric check (waist > 0),
  hips numeric check (hips > 0),
  left_thigh numeric check (left_thigh > 0),
  right_thigh numeric check (right_thigh > 0),
  left_calf numeric check (left_calf > 0),
  right_calf numeric check (right_calf > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An entry must measure something.
  check (num_nonnulls(weight, lean_mass, fat_percent, neck, shoulders, chest, left_bicep, right_bicep,
    left_forearm, right_forearm, abdomen, waist, hips, left_thigh, right_thigh, left_calf, right_calf) > 0)
);

alter table public.body_measurements enable row level security;

create policy "owner manages body measurements" on public.body_measurements
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
