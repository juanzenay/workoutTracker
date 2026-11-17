-- Moves the owner made by hand within a week (run today instead of tomorrow, swap upper and lower): a lifting
-- session or a planned run on its engine-planned day (`from_date`) goes to `to_date`. The engine reads them on
-- every re-plan (src/engine/moves.ts), so a move survives progression, new workouts and the daily job.

create table public.plan_moves (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('session', 'run')),
  block_session_id uuid references public.block_sessions (id) on delete cascade,
  run_plan_id uuid references public.run_plans (id) on delete cascade,
  row_index integer check (row_index >= 0),
  from_date date not null,
  to_date date not null check (to_date <> from_date),
  created_at timestamptz not null default now(),
  check (
    (kind = 'session' and block_session_id is not null and run_plan_id is null and row_index is null)
    or (kind = 'run' and block_session_id is null and run_plan_id is not null and row_index is not null)
  )
);

-- One move per planned item and engine day.
create unique index plan_moves_session_idx on public.plan_moves (block_session_id, from_date) where kind = 'session';
create unique index plan_moves_run_idx on public.plan_moves (run_plan_id, row_index, from_date) where kind = 'run';

alter table public.plan_moves enable row level security;

create policy "owner manages plan_moves" on public.plan_moves
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
