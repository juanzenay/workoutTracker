-- A workout's Strava post is sent outside any database transaction (#17, "never
-- twice"): it is claimed first (posting_since, committed), then sent, then its
-- outcome recorded in a transaction of its own. posting_since set = sent (or being
-- sent) and the outcome not recorded yet: no other run sends it meanwhile, and a
-- retry first looks on Strava for the activity before creating one.
-- See src/server/commands/strava-posts.ts.

alter table public.strava_workout_posts add column posting_since timestamptz;
