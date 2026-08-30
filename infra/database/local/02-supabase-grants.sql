-- The table privileges hosted Supabase grants for us. Run after the migrations.
--
-- Our migrations enable row level security and write policies, but never grant
-- the underlying table privileges: on hosted Supabase those arrive from its own
-- bootstrap, which grants `authenticated` and `service_role` access to
-- everything in `public` by default. Without them RLS never gets a chance to
-- run -- Postgres refuses on the grant first -- so the policy suite fails with
-- "permission denied" rather than testing anything.
--
-- Worth being explicit about what this means: the schema is not self-contained.
-- Moving to a Postgres that is not Supabase needs this file, or an equivalent,
-- as part of the deployment. It is applied separately rather than folded into a
-- migration because on hosted Supabase it is redundant, and a migration that is
-- a no-op on the only database anyone runs is a migration nobody maintains.

grant usage on schema public to anon, authenticated, service_role;

-- `anon` is granted too, exactly as Supabase does. It matters for the policy
-- suite: an unauthenticated caller must see zero rows *because RLS filtered
-- them*, not because the grant was missing. Without the grant the query errors
-- and the test would pass for the wrong reason.
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Anything created later gets the same treatment, so a new migration does not
-- silently arrive locked.
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
