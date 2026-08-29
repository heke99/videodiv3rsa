-- Pin search_path on the remaining helpers so a role-local search_path cannot
-- redirect them to an attacker-controlled schema.
alter function app.set_updated_at() set search_path = pg_catalog, pg_temp;
alter function app.is_service_role() set search_path = pg_catalog, pg_temp;
