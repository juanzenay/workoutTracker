-- Self-hosting (#29): the first sign-up claims the deployment. The deploy step can reserve the
-- claim for one email (OWNER_EMAIL, see src/server/deploy/migrate.ts), so nobody who finds a
-- freshly deployed URL can claim it first. The sign-in page asks whether the claim is still open.

create table public.owner_email (
  singleton boolean primary key default true check (singleton),
  email text not null check (email = lower(btrim(email)) and email <> '')
);

-- No policies: only the deploy step (table owner) and security-definer functions touch it.
alter table public.owner_email enable row level security;
revoke all on public.owner_email from anon, authenticated;

create or replace function public.claim_ownership() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  reserved text := (select email from public.owner_email);
begin
  if exists (select 1 from public.owner) then
    raise exception 'workout tracker is locked to its owner; no other accounts can be created'
      using errcode = 'insufficient_privilege';
  end if;
  if reserved is not null and lower(btrim(coalesce(new.email, ''))) <> reserved then
    raise exception 'workout tracker is reserved for its owner''s email; this account cannot claim it'
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.owner (user_id) values (new.id);
  return new;
end
$$;

revoke execute on function public.claim_ownership() from public, anon, authenticated;

-- Whether an owner has claimed this deployment. Anyone may ask (the sign-in page offers the claim only while open).
create function public.deployment_claimed() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.owner)
$$;

grant execute on function public.deployment_claimed() to anon, authenticated;
