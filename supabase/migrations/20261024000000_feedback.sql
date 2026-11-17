-- Feedback: issues and ideas the owner jots down in the app to tackle later. Open until done_at is set.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(btrim(body)) between 1 and 4000),
  done_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "owner manages feedback" on public.feedback
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
