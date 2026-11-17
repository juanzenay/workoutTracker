-- Nightly backup runs (Vercel Cron → runBackup command). The latest success is
-- shown on the export page; failures also raise an important inbox item.
-- See src/server/commands/backup.ts.

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('succeeded', 'failed')),
  -- Where it went (or was meant to go); null when no target is configured.
  target text check (target in ('github', 'storage')),
  -- File URL / storage path on success.
  location text,
  error text,
  created_at timestamptz not null default now()
);

create index backup_runs_created_idx on public.backup_runs (created_at desc, id);

alter table public.backup_runs enable row level security;

create policy "owner manages backup_runs" on public.backup_runs
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
