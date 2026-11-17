-- Plan revisions: every engine (or coach/user) change to the plan, with its
-- diff, plain-language reasons, source and status. Applied revisions are
-- already in planned_sessions; pending ones wait for the owner's confirmation;
-- undone/rejected ones stay off the plan (the engine's change key is matched on
-- every re-plan). See src/domain/plan-change.ts.

create table public.plan_revisions (
  id uuid primary key default gen_random_uuid(),
  -- PlanChange.key: the same change re-emitted on a later re-plan has the same key.
  key text not null,
  -- The block the change is about (null for changes not tied to a block, e.g. runs later).
  block_id uuid references public.blocks (id) on delete cascade,
  source text not null default 'engine' check (source in ('engine', 'coach', 'user')),
  status text not null check (status in ('applied', 'pending', 'undone', 'rejected', 'superseded')),
  summary text not null,
  reasons text[] not null default '{}',
  -- PlanDiffItem[]: before/after per planned item.
  diff jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plan_revisions_key_idx on public.plan_revisions (key, created_at desc);
create index plan_revisions_status_idx on public.plan_revisions (status, created_at desc);

alter table public.plan_revisions enable row level security;

create policy "owner manages plan_revisions" on public.plan_revisions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
