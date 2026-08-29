import type { DependencyKind, InvalidationResult, Shot, ShotDependency, ShotPlan } from "@videoai/contracts";

/**
 * Shot dependency graph and invalidation (spec section 15).
 *
 * The point of this module is restraint: when a character changes, exactly the
 * shots that depend on that character go stale, plus whatever transitively
 * depends on those shots through a frame handoff. Nothing else is touched, so
 * a wardrobe correction does not regenerate a film.
 */

/** Edges the planner can infer from a shot without being told. */
export function deriveDependencies(shots: Shot[]): ShotDependency[] {
  const edges: ShotDependency[] = [];
  const byIndex = [...shots].sort((a, b) => a.index - b.index);

  for (const shot of byIndex) {
    for (const id of shot.character_ids) edges.push({ shot_id: shot.id, kind: "character", ref: id });
    for (const id of shot.product_ids) edges.push({ shot_id: shot.id, kind: "product", ref: id });
    if (shot.location_id) edges.push({ shot_id: shot.id, kind: "location", ref: shot.location_id });
    for (const id of shot.dialogue_line_ids) {
      edges.push({ shot_id: shot.id, kind: "dialogue", ref: id });
    }
  }

  // A shot that continues from the previous one in the same scene inherits its
  // end frame, which is what makes continuity work and what makes invalidation
  // propagate forward.
  for (let i = 1; i < byIndex.length; i++) {
    const prev = byIndex[i - 1]!;
    const cur = byIndex[i]!;
    if (cur.scene_id !== prev.scene_id) continue;
    if (cur.start_frame_asset) continue; // explicit keyframe breaks the chain
    edges.push({ shot_id: cur.id, kind: "shot_end_frame", ref: prev.id });
  }

  return dedupe(edges);
}

function dedupe(edges: ShotDependency[]): ShotDependency[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.shot_id}|${e.kind}|${e.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ChangedEntity {
  kind: DependencyKind;
  ref: string;
}

/**
 * Which shots go stale when entities change.
 *
 * Direct hits are shots with an edge to the changed entity. Propagation then
 * follows frame handoffs only: a later shot that starts from an invalidated
 * shot's end frame is itself invalid. Sharing a character with a stale shot is
 * not a reason to regenerate.
 */
export function invalidate(plan: ShotPlan, changes: ChangedEntity[]): InvalidationResult[] {
  const edges = plan.dependencies.length > 0 ? plan.dependencies : deriveDependencies(plan.shots);

  const dependents = new Map<string, ShotDependency[]>();
  for (const edge of edges) {
    const key = `${edge.kind}|${edge.ref}`;
    const list = dependents.get(key) ?? [];
    list.push(edge);
    dependents.set(key, list);
  }

  // Frame handoffs indexed by the shot they read from.
  const frameChildren = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "shot_end_frame" && edge.kind !== "shot_start_frame") continue;
    const list = frameChildren.get(edge.ref) ?? [];
    list.push(edge.shot_id);
    frameChildren.set(edge.ref, list);
  }

  return changes.map((change) => {
    const reasons = new Map<string, string[]>();
    const direct = dependents.get(`${change.kind}|${change.ref}`) ?? [];

    const queue: string[] = [];
    for (const edge of direct) {
      addReason(reasons, edge.shot_id, `depends on ${change.kind} "${change.ref}"`);
      queue.push(edge.shot_id);
    }

    // Breadth-first along frame handoffs. `reasons` doubles as the visited set,
    // so a cycle in a malformed plan terminates instead of looping.
    while (queue.length > 0) {
      const shotId = queue.shift()!;
      for (const child of frameChildren.get(shotId) ?? []) {
        if (reasons.has(child)) continue;
        addReason(reasons, child, `continues from shot "${shotId}" which is stale`);
        queue.push(child);
      }
    }

    return {
      changed_ref: change.ref,
      changed_kind: change.kind,
      stale_shot_ids: [...reasons.keys()].sort(),
      reasons: Object.fromEntries(reasons),
    };
  });
}

function addReason(map: Map<string, string[]>, shotId: string, reason: string): void {
  const list = map.get(shotId) ?? [];
  if (!list.includes(reason)) list.push(reason);
  map.set(shotId, list);
}

/** Validate that a plan's edges point at things that exist. */
export function validatePlanGraph(plan: ShotPlan): string[] {
  const errors: string[] = [];
  const shotIds = new Set(plan.shots.map((s) => s.id));
  const sceneIds = new Set(plan.scenes.map((s) => s.id));

  for (const shot of plan.shots) {
    if (!sceneIds.has(shot.scene_id)) {
      errors.push(`Shot ${shot.id} belongs to unknown scene ${shot.scene_id}`);
    }
  }
  for (const scene of plan.scenes) {
    for (const id of scene.shot_ids) {
      if (!shotIds.has(id)) errors.push(`Scene ${scene.id} lists unknown shot ${id}`);
    }
  }
  for (const edge of plan.dependencies) {
    if (!shotIds.has(edge.shot_id)) {
      errors.push(`Dependency references unknown shot ${edge.shot_id}`);
    }
    if ((edge.kind === "shot_end_frame" || edge.kind === "shot_start_frame") && !shotIds.has(edge.ref)) {
      errors.push(`Shot ${edge.shot_id} reads a frame from unknown shot ${edge.ref}`);
    }
  }
  return errors;
}
