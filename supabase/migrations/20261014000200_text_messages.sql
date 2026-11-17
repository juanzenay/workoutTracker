-- Generated text as messages: plan change summaries and reasons, and inbox
-- titles and bodies, are stored as Text (src/domain/message.ts) — a message
-- (code + parameters, rendered by src/strings at display time in the viewer's
-- skin) or free text. Rows from before keep their words: free text becomes a
-- JSON string, which reads back as the same text. An inbox body is a list of
-- texts (a plan change's reasons); an old body becomes a list of one.

alter table public.plan_revisions alter column summary type jsonb using to_jsonb(summary);
alter table public.plan_revisions alter column reasons drop default;
alter table public.plan_revisions alter column reasons type jsonb using to_jsonb(reasons);
alter table public.plan_revisions alter column reasons set default '[]'::jsonb;

alter table public.inbox_items alter column title type jsonb using to_jsonb(title);
alter table public.inbox_items alter column body type jsonb
  using case when body is null then null else jsonb_build_array(body) end;
