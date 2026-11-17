-- Initial plan revisions: an engine change that is part of first planning what it
-- touches (a new block's sessions, a newly imported run plan and how lifting fits
-- around it) applies silently. It is recorded (status 'initial') only so later
-- re-plans recognise its key; it is never shown, announced or confirmed.
-- See src/engine/policy.ts and src/server/commands/plan-revisions.ts.

alter table public.plan_revisions drop constraint plan_revisions_status_check;
alter table public.plan_revisions add constraint plan_revisions_status_check
  check (status in ('proposed', 'applied', 'pending', 'undone', 'rejected', 'superseded', 'initial'));
