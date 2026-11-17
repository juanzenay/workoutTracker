-- Runs the owner types in by hand (a distance for a day) sit beside Strava's and imported files' in `activities`,
-- and go through the same run matching and re-plan.

alter table public.activities drop constraint activities_source_check;
alter table public.activities add constraint activities_source_check check (source in ('strava', 'file', 'manual'));
alter table public.activities drop constraint activities_source_fields;
alter table public.activities add constraint activities_source_fields check (
  (source = 'strava' and strava_id is not null and raw is not null)
  or (source = 'file' and strava_id is null)
  or (source = 'manual' and strava_id is null and file_name is null)
);
