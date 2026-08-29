-- Caption rebuilds and upscale re-runs are repair scopes in their own right:
-- both fix a real failure class without touching a model, which makes them the
-- cheapest options the repair planner can choose. They were missing from the
-- constraint, so the planner could not record them.

alter table public.repair_plans drop constraint if exists repair_plans_scope_check;

alter table public.repair_plans add constraint repair_plans_scope_check
  check (scope in (
    'none', 'lipsync', 'audio', 'timing', 'caption', 'upscale',
    'frame', 'keyframe', 'shot', 'scene', 'dependent_shots', 'project'
  ));
