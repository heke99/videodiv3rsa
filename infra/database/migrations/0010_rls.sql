-- Row level security, deny by default.
--
-- Every table already has RLS enabled and no policies, which means no access at
-- all. This migration grants back exactly three shapes:
--
--   tenant_rw  members of the owning organisation may read and write
--   tenant_ro  members may read; only the service credential writes, because
--              these rows are pipeline output or an audit trail and a user
--              editing them would let them forge provenance, quality results,
--              usage or credits
--   registry   everyone authenticated may read; only platform staff may write,
--              because routing and licence status decide which models a user
--              can reach
--
-- The service credential (used by the API, the orchestrator and the GPU
-- gateway) is the only writer for the read-only set. Workers never hold a user
-- session (spec section 61).

do $$
declare
  t text;
  tenant_rw text[] := array[
    'projects', 'project_versions', 'project_settings',
    'assets', 'asset_versions', 'asset_relationships',
    'scene_bibles', 'scene_bible_versions',
    'characters', 'character_versions', 'character_references',
    'products', 'product_versions', 'product_references',
    'locations', 'location_versions', 'style_profiles', 'voice_profiles',
    'scripts', 'script_versions', 'storyboards', 'storyboard_versions',
    'scenes', 'scene_versions', 'shots', 'shot_versions', 'shot_dependencies',
    'timelines', 'timeline_versions', 'timeline_tracks', 'timeline_events',
    'dialogue_alignments', 'rights_declarations', 'consents',
    'generation_feedback', 'human_evaluations'
  ];
  tenant_ro text[] := array[
    'generation_jobs', 'generation_steps', 'generation_attempts', 'generation_outputs',
    'quality_evaluations', 'quality_metrics', 'quality_findings',
    'repair_plans', 'repair_attempts',
    'usage_events', 'usage_rollups', 'credit_ledger', 'subscriptions', 'billing_events',
    'renders', 'exports', 'downloads',
    'retention_policies', 'deletion_jobs', 'audit_events'
  ];
  registry text[] := array[
    'model_registry', 'model_licenses', 'model_versions', 'model_capabilities',
    'model_artifacts', 'routing_rules', 'model_benchmarks',
    'skill_registry', 'skill_versions', 'skill_evaluations'
  ];
begin
  foreach t in array tenant_rw loop
    execute format($f$
      create policy %1$I_member_select on public.%1$I for select to authenticated
        using (app.is_org_member(organization_id));
      create policy %1$I_member_insert on public.%1$I for insert to authenticated
        with check (app.is_org_member(organization_id));
      create policy %1$I_member_update on public.%1$I for update to authenticated
        using (app.is_org_member(organization_id))
        with check (app.is_org_member(organization_id));
      create policy %1$I_member_delete on public.%1$I for delete to authenticated
        using (app.has_org_role(organization_id, array['owner','admin','member']));
    $f$, t);
  end loop;

  foreach t in array tenant_ro loop
    execute format($f$
      create policy %1$I_member_select on public.%1$I for select to authenticated
        using (app.is_org_member(organization_id));
    $f$, t);
  end loop;

  foreach t in array registry loop
    execute format($f$
      create policy %1$I_read on public.%1$I for select to authenticated using (true);
      create policy %1$I_admin_write on public.%1$I for all to authenticated
        using (app.is_platform_admin()) with check (app.is_platform_admin());
    $f$, t);
  end loop;
end
$$;

-- Identity tables need their own shapes.

create policy profiles_self_select on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_self_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy organizations_member_select on public.organizations for select to authenticated
  using (app.is_org_member(id));
create policy organizations_owner_update on public.organizations for update to authenticated
  using (app.has_org_role(id, array['owner','admin']))
  with check (app.has_org_role(id, array['owner','admin']));
-- Anyone signed in may create an organisation; the creating user is added as
-- owner by the API in the same transaction.
create policy organizations_insert on public.organizations for insert to authenticated
  with check (created_by = auth.uid());

create policy organization_members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or app.is_org_member(organization_id));
create policy organization_members_admin_write on public.organization_members for all to authenticated
  using (app.has_org_role(organization_id, array['owner','admin']))
  with check (app.has_org_role(organization_id, array['owner','admin']));

-- Platform admin membership is readable by staff only and writable by nobody
-- through the API; it is granted by migration or by the service credential.
create policy platform_admins_self_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- GPU fleet is operational data. Staff may read it for the admin UI; ordinary
-- users have no reason to see worker endpoints and never do.
do $$
declare t text;
begin
  foreach t in array array[
    'gpu_workers', 'gpu_worker_capabilities', 'gpu_worker_models',
    'gpu_sessions', 'gpu_reservations'
  ] loop
    execute format($f$
      create policy %1$I_admin_read on public.%1$I for select to authenticated
        using (app.is_platform_admin());
    $f$, t);
  end loop;
end
$$;

-- Skill runs are per-organisation when they belong to a job, and platform-wide
-- when they do not, so they need a hand written policy.
create policy skill_runs_select on public.skill_runs for select to authenticated
  using (
    (organization_id is not null and app.is_org_member(organization_id))
    or (organization_id is null and app.is_platform_admin())
  );
