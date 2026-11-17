-- Completed activities come from Strava or from files the owner imports
-- (FIT / GPX / TCX exported from the watch's app, #31). One table for both, so
-- run matching, re-plans, mileage and running load read them alike.

alter table public.strava_activities rename to activities;
alter index public.strava_activities_local_date_idx rename to activities_local_date_idx;
alter index public.strava_activities_planned_run_idx rename to activities_planned_run_idx;
alter policy "owner manages strava_activities" on public.activities rename to "owner manages activities";

-- Strava's activity id becomes one column among others; every row gets its own id.
alter table public.activities drop constraint strava_activities_pkey;
alter table public.activities rename column id to strava_id;
alter table public.activities alter column strava_id drop not null;
alter table public.activities add constraint activities_strava_id_key unique (strava_id);
alter table public.activities add column id uuid not null default gen_random_uuid();
alter table public.activities add primary key (id);

-- Where it came from. A file activity has no Strava id and keeps the file's name; `raw` is Strava's payload.
alter table public.activities add column source text not null default 'strava' check (source in ('strava', 'file'));
alter table public.activities alter column source drop default;
alter table public.activities add column file_name text;
alter table public.activities alter column raw drop not null;
alter table public.activities add constraint activities_source_fields check (
  (source = 'strava' and strava_id is not null and raw is not null) or (source = 'file' and strava_id is null)
);
create index activities_start_date_idx on public.activities (start_date);

-- How far file imports reach: the latest local day any imported file had an activity on. Without Strava,
-- a planned run with nothing logged is only judged missed once imports cover a later day (runs arrive late).
create table public.activity_import_coverage (
  id boolean primary key default true check (id),
  covered_through date not null,
  updated_at timestamptz not null default now()
);

alter table public.activity_import_coverage enable row level security;
create policy "owner manages activity_import_coverage" on public.activity_import_coverage
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
