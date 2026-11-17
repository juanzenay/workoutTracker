-- Coach changes (#22): the coach (Claude in chat, via the MCP server) proposes
-- a change — mark unavailable, add/update a race, import a run plan — which is
-- stored as a `proposed` plan revision and applied only when the owner approves
-- in chat. An applied coach change is one revision (source 'coach'): the engine
-- changes it causes are folded into it as child revisions (parent_id), and undo
-- puts the engine's inputs back as they were (coach.inputs). See
-- src/server/commands/coach.ts.

alter table public.plan_revisions drop constraint plan_revisions_status_check;
alter table public.plan_revisions add constraint plan_revisions_status_check
  check (status in ('proposed', 'applied', 'pending', 'undone', 'rejected', 'superseded'));

-- The coach change this engine change was folded into (shown and undone with it).
alter table public.plan_revisions add column parent_id uuid references public.plan_revisions (id) on delete cascade;
-- Coach revisions only: { action, reason, inputs } — what to do, why, and (once applied)
-- the engine-input rows before/after, so undo can restore them.
alter table public.plan_revisions add column coach jsonb;

create index plan_revisions_parent_idx on public.plan_revisions (parent_id) where parent_id is not null;
