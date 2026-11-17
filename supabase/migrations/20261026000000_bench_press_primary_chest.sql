-- Bench-press variants were seeded with triceps as the primary muscle and chest
-- as a secondary; chest is the primary. Side Leg Raises (hip abduction) were seeded
-- as an adductor exercise. Matches vendor/free-exercise-db.
update public.exercises e
set primary_muscles = v.primary_muscles, secondary_muscles = v.secondary_muscles
from (values
  ('Bench_Press_-_Powerlifting', array['chest']::text[], array['triceps','forearms','lats','shoulders']::text[]),
  ('Bench_Press_with_Chains', array['chest']::text[], array['triceps','lats','shoulders']::text[]),
  ('Board_Press', array['chest']::text[], array['triceps','forearms','lats','shoulders']::text[]),
  ('Dumbbell_Floor_Press', array['chest']::text[], array['triceps','shoulders']::text[]),
  ('Floor_Press', array['chest']::text[], array['triceps','shoulders']::text[]),
  ('Floor_Press_with_Chains', array['chest']::text[], array['triceps','shoulders']::text[]),
  ('One_Arm_Floor_Press', array['chest']::text[], array['triceps','shoulders']::text[]),
  ('Pin_Presses', array['chest']::text[], array['triceps','forearms','lats','middle back','shoulders']::text[]),
  ('Side_Leg_Raises', array['abductors']::text[], array['glutes']::text[]),
  ('Reverse_Band_Bench_Press', array['chest']::text[], array['triceps','forearms','lats','middle back','shoulders']::text[])
) as v(source_ref, primary_muscles, secondary_muscles)
where e.source = 'free-exercise-db' and e.source_ref = v.source_ref;
