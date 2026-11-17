-- Inbox and Web Push. Every notification is an inbox item; important items
-- also go out as Web Push to every subscribed device (installed PWA). See
-- src/domain/inbox.ts and src/server/commands/inbox.ts.

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  -- What raised it, e.g. plan_change_pending, plan_change_applied, backup_failed.
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$'),
  -- important: needs the owner (pushed, never grouped); minor: FYI (grouped when back to back).
  level text not null check (level in ('important', 'minor')),
  title text not null,
  body text,
  -- In-app path the item (and its push notification) opens; never protocol-relative (//host).
  url text check (url ~ '^/([^/\\]|$)'),
  created_at timestamptz not null default now()
);

create index inbox_items_created_idx on public.inbox_items (created_at desc, id);

alter table public.inbox_items enable row level security;

create policy "owner manages inbox_items" on public.inbox_items
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- One row per device that enabled push (PushSubscription.toJSON()).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "owner manages push_subscriptions" on public.push_subscriptions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
