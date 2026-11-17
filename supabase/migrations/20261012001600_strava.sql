-- Strava (single-athlete mode): the owner's OAuth tokens, the app's webhook
-- subscription, webhook events as received, the activities they point at, and
-- each planned run's outcome. Strava is the source of truth for completed
-- runs. Distances in meters, times in seconds.

-- The connected athlete. One row at most. Tokens never leave the server.
create table public.strava_connection (
  id boolean primary key default true check (id),
  athlete_id bigint not null,
  athlete_name text,
  scope text[] not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The deployment's push subscription (Strava allows one per app).
create table public.strava_webhook (
  id boolean primary key default true check (id),
  subscription_id bigint not null,
  callback_url text not null,
  created_at timestamptz not null default now()
);

-- Webhook events, recorded before processing (Strava wants a reply within 2 s
-- and retries; the unique key makes retries no-ops).
create table public.strava_events (
  id bigint generated always as identity primary key,
  object_type text not null check (object_type in ('activity', 'athlete')),
  object_id bigint not null,
  aspect_type text not null check (aspect_type in ('create', 'update', 'delete')),
  owner_id bigint not null,
  subscription_id bigint not null,
  event_time bigint not null,
  updates jsonb not null default '{}',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text,
  unique (object_type, object_id, aspect_type, event_time)
);

create index strava_events_pending_idx on public.strava_events (id) where processed_at is null;

-- Activities as last fetched from Strava (never trusted from the event payload).
create table public.strava_activities (
  id bigint primary key,
  name text,
  sport_type text not null,
  start_date timestamptz not null,
  -- Wall-clock start where it happened; local_date is what runs are matched on.
  start_date_local timestamp not null,
  local_date date not null,
  distance_meters numeric not null default 0,
  moving_seconds integer,
  elapsed_seconds integer,
  manual boolean not null default false,
  device_name text,
  raw jsonb not null,
  -- The planned run this activity counts toward (set by matching; null = unplanned or not a run).
  planned_run_id uuid references public.planned_runs (id) on delete set null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index strava_activities_local_date_idx on public.strava_activities (local_date);
create index strava_activities_planned_run_idx on public.strava_activities (planned_run_id);

-- Outcome of a planned run: done / partial (actual short of plan) / missed
-- (day over, nothing run). Null = still to come, or a rest/cross day.
alter table public.planned_runs
  add column status text check (status in ('done', 'partial', 'missed')),
  add column actual_meters numeric,
  add column actual_seconds integer;

alter table public.strava_connection enable row level security;
alter table public.strava_webhook enable row level security;
alter table public.strava_events enable row level security;
alter table public.strava_activities enable row level security;

create policy "owner manages strava_connection" on public.strava_connection
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages strava_webhook" on public.strava_webhook
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages strava_events" on public.strava_events
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages strava_activities" on public.strava_activities
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
