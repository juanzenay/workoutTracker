-- Injuries the owner logs (a ligament sprain, a tendon, a strain). The engine
-- re-plans lifting around the ones still open (src/engine/injuries.ts).

create table public.injuries (
  id uuid primary key default gen_random_uuid(),
  joint text not null check (joint in ('neck', 'shoulder', 'elbow', 'wrist', 'lower back', 'hip', 'knee', 'ankle')),
  side text not null check (side in ('left', 'right', 'both')),
  tissue text not null check (tissue in ('ligament', 'tendon', 'muscle', 'joint', 'bone', 'other')),
  grade smallint not null check (grade between 1 and 3),
  start_date date not null,
  -- The day training is back to normal; null while still injured.
  cleared_date date,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (cleared_date is null or cleared_date >= start_date)
);

create index injuries_open_idx on public.injuries (start_date) where cleared_date is null;

alter table public.injuries enable row level security;

create policy "owner manages injuries" on public.injuries
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
