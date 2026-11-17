-- Body measurements use the same weight unit type as every other weight
-- (public.weight_unit, 20261011000400_workouts.sql) instead of text + check.

alter table public.body_measurements drop constraint body_measurements_weight_unit_check;
alter table public.body_measurements alter column weight_unit drop default;
alter table public.body_measurements
  alter column weight_unit type public.weight_unit using weight_unit::public.weight_unit;
alter table public.body_measurements alter column weight_unit set default 'lb';
