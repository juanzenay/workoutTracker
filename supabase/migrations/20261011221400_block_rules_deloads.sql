-- Progression rules beyond double progression (RIR-informed, set ramp) and
-- planned deload weeks. Archive status is derived from dates (a block whose
-- last day is before today in its zone is archived), so it needs no column.

alter table public.block_exercises drop constraint block_exercises_rule_check;
alter table public.block_exercises
  add constraint block_exercises_rule_check check (rule in ('double', 'rir', 'ramp'));

-- Set ramp target: sets climb from `sets` to this across the block's training weeks.
alter table public.block_exercises
  add column ramp_to integer check (ramp_to is null or (ramp_to > sets and ramp_to <= 20)),
  add constraint block_exercises_ramp_check check (rule <> 'ramp' or ramp_to is not null);

-- 1-based weeks of the block that are deloads (lighter sessions).
alter table public.blocks
  add column deload_weeks integer[] not null default '{}'
    check (1 <= all (deload_weeks) and 52 >= all (deload_weeks));

-- Engine output: the planned session falls in a deload week.
alter table public.planned_sessions add column deload boolean not null default false;
