-- Foundation: helper schema, tenancy helpers, and shared triggers.
-- Every later migration builds on the helpers defined here so that tenant
-- isolation is expressed one way across the whole schema.

create schema if not exists app;

-- Enum-like domains kept as text + check so a value can be added by migration
-- without a type rewrite blocking deploys.

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- True only for the backend's scoped service credential. GPU workers and the
-- orchestrator authenticate this way; they never carry a user session.
create or replace function app.is_service_role() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

-- Platform staff. Deliberately a table rather than a claim so access can be
-- revoked without reissuing tokens.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);
alter table public.platform_admins enable row level security;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;
