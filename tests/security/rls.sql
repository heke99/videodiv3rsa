-- Row level security verification (spec section 89).
--
-- Run against a real Postgres, because the thing being tested is how Postgres
-- applies the policies, not how we think it does. Everything happens inside a
-- transaction that is rolled back, so the suite leaves no trace and can be run
-- against a live database.
--
--   psql "$DATABASE_URL" -f tests/security/rls.sql
--
-- Every row of the output must have passed = true.
--
-- One subtlety worth keeping: an UPDATE or DELETE filtered by RLS succeeds
-- having touched nothing, rather than raising. Treating that as success
-- reports a policy hole where there is none, so try_write checks the row count
-- for anything that is not an insert, and the E-series independently confirms
-- that the data a denial reported really is unchanged.

begin;

create temp table rls_results (check_name text, expected text, actual text) on commit drop;
grant insert, select on rls_results to authenticated, anon;

create or replace function pg_temp.try_write(sql text) returns text
language plpgsql security invoker as $fn$
declare
  affected bigint;
begin
  execute sql;
  get diagnostics affected = row_count;
  return case when affected > 0 then 'allowed' else 'denied' end;
exception
  when insufficient_privilege or check_violation then return 'denied';
  when others then return 'denied:' || sqlstate;
end;
$fn$;
grant execute on function pg_temp.try_write(text) to authenticated, anon;

-- Two tenants and one member of platform staff.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid', '', now(), now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid', '', now(), now(), now()),
  ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.invalid', '', now(), now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('a0000000-0000-4000-8000-00000000000a', 'Org A', 'org-a-rlstest', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-00000000000b', 'Org B', 'org-b-rlstest', 'bbbbbbbb-0000-4000-8000-000000000002');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('a0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', 'active'),
  ('b0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner', 'active');

insert into public.platform_admins (user_id) values ('cccccccc-0000-4000-8000-000000000003');

insert into public.projects (id, organization_id, title, created_by) values
  ('a1000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Project A', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'Project B', 'bbbbbbbb-0000-4000-8000-000000000002');

insert into public.generation_jobs (id, organization_id, project_id, created_by) values
  ('a2000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.credit_ledger (organization_id, delta, balance_after, reason) values
  ('a0000000-0000-4000-8000-00000000000a', 100, 100, 'seed');

insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, profile) values
  ('rlstest-worker', 'manual', 'ref', 'http://worker.internal:8080', 'GPU_PROFILE_ULTRA');

-- ---- an ordinary user ----------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

insert into rls_results values
  ('A01 sees only their own project', '1', (select count(*)::text from public.projects)),
  ('A02 cannot read org B project', '0', (select count(*)::text from public.projects where organization_id = 'b0000000-0000-4000-8000-00000000000b')),
  ('A03 sees their own job', '1', (select count(*)::text from public.generation_jobs)),
  ('A04 sees their own credit ledger', '1', (select count(*)::text from public.credit_ledger)),
  ('A05 cannot see GPU workers', '0', (select count(*)::text from public.gpu_workers)),
  ('A06 can read the model registry', 'true', (select (count(*) > 0)::text from public.model_registry)),
  ('A07 cannot write the model registry', 'denied',
    pg_temp.try_write($w$update public.model_registry set display_name = 'hacked' where model_id = 'wan2.2-t2v-a14b'$w$)),
  ('A08 cannot approve a licence', 'denied',
    pg_temp.try_write($w$update public.model_licenses set status = 'approved' where model_id = 'hunyuan-video'$w$)),
  ('A09 cannot grant themselves credit', 'denied',
    pg_temp.try_write($w$insert into public.credit_ledger (organization_id, delta, balance_after, reason) values ('a0000000-0000-4000-8000-00000000000a', 1000000, 1000000, 'self-grant')$w$)),
  ('A10 cannot forge a generation job', 'denied',
    pg_temp.try_write($w$insert into public.generation_jobs (organization_id, project_id) values ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$w$)),
  ('A11 cannot create a project in org B', 'denied',
    pg_temp.try_write($w$insert into public.projects (organization_id, title) values ('b0000000-0000-4000-8000-00000000000b', 'intrusion')$w$)),
  ('A12 cannot register a GPU worker', 'denied',
    pg_temp.try_write($w$insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, profile) values ('forged', 'manual', 'r', 'http://x', 'GPU_PROFILE_ULTRA')$w$)),
  ('A13 can create a project in their own org', 'allowed',
    pg_temp.try_write($w$insert into public.projects (organization_id, title, created_by) values ('a0000000-0000-4000-8000-00000000000a', 'legitimate', 'aaaaaaaa-0000-4000-8000-000000000001')$w$)),
  ('A14 cannot delete another org project', 'denied',
    pg_temp.try_write($w$delete from public.projects where id = 'b1000000-0000-4000-8000-00000000000b'$w$));

-- ---- a different tenant --------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

insert into rls_results values
  ('B01 cannot read org A projects', '0', (select count(*)::text from public.projects where organization_id = 'a0000000-0000-4000-8000-00000000000a')),
  ('B02 cannot read org A jobs', '0', (select count(*)::text from public.generation_jobs)),
  ('B03 cannot read org A credit', '0', (select count(*)::text from public.credit_ledger)),
  ('B04 cannot update org A project', 'denied',
    pg_temp.try_write($w$update public.projects set title = 'stolen' where id = 'a1000000-0000-4000-8000-00000000000a'$w$));

-- ---- platform staff ------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';

insert into rls_results values
  ('C01 staff can see GPU workers', 'true', (select (count(*) > 0)::text from public.gpu_workers)),
  ('C02 staff can approve a licence', 'allowed',
    pg_temp.try_write($w$update public.model_licenses set status = 'approved' where model_id = 'wan2.2-t2v-a14b'$w$)),
  -- Staff operate the platform; they are not members of a tenant and do not
  -- get to read customer work.
  ('C03 staff still cannot read a tenant project', '0', (select count(*)::text from public.projects));

-- ---- an unauthenticated caller ------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into rls_results values
  ('D01 anon sees no projects', '0', (select count(*)::text from public.projects)),
  ('D02 anon sees no organizations', '0', (select count(*)::text from public.organizations)),
  ('D03 anon sees no model registry', '0', (select count(*)::text from public.model_registry));

-- ---- independent confirmation -------------------------------------------
reset role;

insert into rls_results values
  ('E01 model registry untouched', 'Wan2.2 T2V-A14B',
    (select display_name from public.model_registry where model_id = 'wan2.2-t2v-a14b')),
  ('E02 blocked licence still blocked', 'blocked',
    (select status from public.model_licenses where model_id = 'hunyuan-video')),
  ('E03 org A project title unchanged', 'Project A',
    (select title from public.projects where id = 'a1000000-0000-4000-8000-00000000000a')),
  ('E04 org B project still exists', '1',
    (select count(*)::text from public.projects where id = 'b1000000-0000-4000-8000-00000000000b')),
  ('E05 no forged credit row', '1',
    (select count(*)::text from public.credit_ledger where organization_id = 'a0000000-0000-4000-8000-00000000000a'));

select check_name, expected, actual, (expected = actual) as passed
from rls_results order by check_name;

-- A verdict, not just a table. Printing results and exiting zero means the
-- suite can only fail a human who happens to read it, which is no use in CI.
-- Raising aborts the transaction, so nothing here is kept either way.
do $verdict$
declare failed int;
begin
  select count(*) into failed from rls_results where expected is distinct from actual;
  if failed > 0 then
    raise exception 'RLS: % of % checks failed', failed, (select count(*) from rls_results);
  end if;
  raise notice 'RLS: all % checks passed', (select count(*) from rls_results);
end $verdict$;

rollback;
