-- Finished workouts posted to Strava as Weight Training activities (#17).
-- A row is queued (once per workout, whatever the outbox replays) when a
-- workout is finished while Strava is connected; posting happens after the
-- sync commits and failed posts are retried by the scheduled job.
create table public.strava_workout_posts (
  workout_id uuid primary key references public.workouts (id) on delete cascade,
  -- The Strava activity created for it; null = not posted yet.
  activity_id bigint,
  attempts integer not null default 0,
  -- The last failure, kept until a post succeeds.
  error text,
  queued_at timestamptz not null default now(),
  posted_at timestamptz
);

create index strava_workout_posts_pending_idx on public.strava_workout_posts (queued_at) where activity_id is null;

alter table public.strava_workout_posts enable row level security;

create policy "owner manages strava_workout_posts" on public.strava_workout_posts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
