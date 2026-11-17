-- Days the owner marked unavailable (sick, travelling, busy): inclusive date
-- ranges in the plan's time zone. The engine re-plans sessions and runs
-- around them (src/engine/replan.ts).

create table public.unavailability (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index unavailability_dates_idx on public.unavailability (start_date, end_date);

alter table public.unavailability enable row level security;

create policy "owner manages unavailability" on public.unavailability
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
