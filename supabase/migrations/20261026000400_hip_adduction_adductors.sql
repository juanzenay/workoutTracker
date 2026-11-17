-- Cable Hip Adduction was seeded as a quadriceps exercise; it works the adductors.
-- Matches vendor/free-exercise-db.
update public.exercises
set primary_muscles = array['adductors']::text[]
where source = 'free-exercise-db' and source_ref = 'Cable_Hip_Adduction';
