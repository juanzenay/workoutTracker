-- Draft blocks (#23): the coach drafts the next block (via the MCP server) or
-- the owner saves one unstarted; a draft is reviewed and edited in workout tracker and
-- plans nothing until it is started. Starting a draft ends the blocks running
-- (or upcoming) then: `ended_on` is the last day they plan, and a block with
-- `ended_on` set is archived from then on (src/server/commands/blocks.ts).

alter table public.blocks
  add column draft boolean not null default false,
  -- The coach's rationale for a drafted block, shown while the owner reviews it.
  add column notes text check (notes is null or length(notes) <= 2000),
  add column ended_on date;
