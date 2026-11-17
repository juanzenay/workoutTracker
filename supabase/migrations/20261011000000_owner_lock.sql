-- workout tracker is single-user: the first account created in Supabase Auth becomes the
-- deployment's owner, and every later account is refused at creation.
-- Every table's RLS policies use public.is_owner().

create table public.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.owner enable row level security;

create function public.is_owner() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.owner where user_id = auth.uid())
$$;

create policy "owner reads owner" on public.owner
  for select to authenticated using (user_id = auth.uid());

create function public.claim_ownership() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.owner) then
    raise exception 'workout tracker is locked to its owner; no other accounts can be created'
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.owner (user_id) values (new.id);
  return new;
end
$$;

revoke execute on function public.claim_ownership() from public, anon, authenticated;

create trigger claim_ownership
  after insert on auth.users
  for each row execute function public.claim_ownership();
