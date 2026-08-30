-- Enough of Supabase to run our schema on a plain Postgres.
--
-- The migrations reference `auth.users`, `auth.uid()` and the three Supabase
-- roles. Hosted Supabase provides them; a local or CI Postgres does not, and
-- without them neither the migrations, the RLS suite nor the SQL schema check
-- can run anywhere except against the live database.
--
-- This is deliberately a stand-in and not a reimplementation: `auth.uid()`
-- reads the same request setting PostgREST sets, and `auth.users` carries only
-- the columns our own schema and tests actually touch. It is never applied to
-- a hosted database, where these objects already exist.

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The identity of the caller, taken from the JWT claims PostgREST puts on the
-- session. Every RLS policy in the schema resolves through this, so the local
-- stand-in has to read the settings the hosted one reads, in the same order --
-- otherwise the policies are exercised against an identity they never see in
-- production, and every one of them "fails" for a reason that is not real.
--
-- Both spellings are checked because both exist: PostgREST sets the flattened
-- `request.jwt.claim.sub` on older versions and the whole `request.jwt.claims`
-- object on newer ones.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;

-- Same shape, for the policies that gate on the caller's role rather than id.
create or replace function auth.role() returns text
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    )
  $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
