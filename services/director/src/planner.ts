import {
  CreativeBrief,
  SceneBible,
  Script,
  ShotPlan,
  RepairPlan,
  type CapabilitySnapshot,
  type CreateVideoRequest,
  type QualityEvaluation,
  type Shot,
} from "@videoai/contracts";
import { deriveDependencies, validatePlanGraph } from "@videoai/scene-bible";
import { secondsToFrames, type Rational } from "@videoai/timeline";
import type { Director } from "./adapter.js";
import {
  BRIEF_SYSTEM,
  REPAIR_SYSTEM,
  SCENE_BIBLE_SYSTEM,
  SCRIPT_SYSTEM,
  SHOT_PLAN_SYSTEM,
} from "./prompts.js";

/**
 * The planning pipeline (spec sections 10, 11, 14, 24).
 *
 * Each stage takes the previous stage's validated output, so the Director never
 * sees raw user text after the brief and never sees a half-formed plan. Stages
 * are separate calls rather than one large one because a rejected shot plan
 * should not cost a regenerated Scene Bible.
 */

export interface PlanningContext {
  capabilities: CapabilitySnapshot;
  timebase: Rational;
}

export class Planner {
  constructor(private readonly director: Director) {}

  async brief(request: CreateVideoRequest, ctx: PlanningContext): Promise<CreativeBrief> {
    // Seconds cross into the system exactly once, here, and become frames.
    const targetFrames = secondsToFrames(request.target_duration_seconds, ctx.timebase);

    const brief = await this.director.plan({
      output: "creative_brief",
      schema: CreativeBrief,
      system: BRIEF_SYSTEM,
      capabilities: ctx.capabilities,
      user: [
        `The user asked for: ${request.prompt}`,
        `Mode: ${request.mode}`,
        `Aspect ratio: ${request.aspect_ratio}`,
        `Target duration: ${targetFrames} frames at ${ctx.timebase.num}/${ctx.timebase.den} fps`,
        request.attachments.length > 0
          ? `They attached: ${request.attachments.map((a) => a.role).join(", ")}`
          : "They attached nothing.",
      ].join("\n"),
    });

    // The brief must honour what the user actually asked for; the Director does
    // not get to reinterpret duration, aspect or mode.
    return {
      ...brief,
      target_duration_frames: targetFrames,
      aspect_ratio: request.aspect_ratio,
      quality_mode: request.mode,
    };
  }

  async sceneBible(brief: CreativeBrief, ctx: PlanningContext): Promise<SceneBible> {
    return this.director.plan({
      output: "scene_bible",
      schema: SceneBible,
      system: SCENE_BIBLE_SYSTEM,
      capabilities: ctx.capabilities,
      user: `Write the Scene Bible for this brief:\n\n${JSON.stringify(brief, null, 2)}`,
    });
  }

  async script(brief: CreativeBrief, bible: SceneBible, ctx: PlanningContext): Promise<Script> {
    return this.director.plan({
      output: "script",
      schema: Script,
      system: SCRIPT_SYSTEM,
      capabilities: ctx.capabilities,
      // Temperature is higher here than for structural stages: this is the one
      // place the output is meant to be creative rather than correct.
      temperature: 0.7,
      user: [
        `Brief:\n${JSON.stringify(brief, null, 2)}`,
        `Characters and voices:\n${JSON.stringify(
          { characters: bible.characters.map((c) => ({ id: c.id, voice_id: c.voice_id })), voices: bible.voices },
          null,
          2,
        )}`,
      ].join("\n\n"),
    });
  }

  async shotPlan(
    brief: CreativeBrief,
    bible: SceneBible,
    script: Script,
    ctx: PlanningContext,
  ): Promise<ShotPlan> {
    const plan = await this.director.plan({
      output: "shot_plan",
      schema: ShotPlan,
      system: SHOT_PLAN_SYSTEM,
      capabilities: ctx.capabilities,
      user: [
        `Brief:\n${JSON.stringify(brief, null, 2)}`,
        `Scene Bible entities:\n${JSON.stringify(entitySummary(bible), null, 2)}`,
        `Script:\n${JSON.stringify(script, null, 2)}`,
        `Total duration must be ${brief.target_duration_frames} frames.`,
      ].join("\n\n"),
    });

    return finalisePlan(plan, brief, ctx);
  }

  async repairPlan(
    evaluation: QualityEvaluation,
    shot: Shot,
    ctx: PlanningContext,
  ): Promise<RepairPlan> {
    return this.director.plan({
      output: "repair_plan",
      schema: RepairPlan,
      system: REPAIR_SYSTEM,
      capabilities: ctx.capabilities,
      temperature: 0.2,
      user: [
        `Shot:\n${JSON.stringify(shot, null, 2)}`,
        `Quality evaluation:\n${JSON.stringify(evaluation, null, 2)}`,
      ].join("\n\n"),
    });
  }
}

/**
 * Post-process a shot plan into something the rest of the system can rely on:
 * a connected graph whose durations add up to what was asked for.
 *
 * The Director is good at deciding where the cuts go and unreliable at
 * arithmetic, so the durations are reconciled here rather than by asking again.
 */
export function finalisePlan(
  plan: ShotPlan,
  brief: CreativeBrief,
  ctx: PlanningContext,
): ShotPlan {
  const errors = validatePlanGraph(plan);
  if (errors.length > 0) {
    throw new Error(`Shot plan is not internally consistent:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const shots = reconcileDurations(plan.shots, brief.target_duration_frames);
  const dependencies =
    plan.dependencies.length > 0 ? plan.dependencies : deriveDependencies(shots);

  return { ...plan, shots, dependencies };
}

/**
 * Scale shot durations so they sum to the target, then fix the rounding
 * remainder on the longest shot.
 *
 * Distributing the remainder onto the longest shot rather than the last one
 * keeps the error proportionally smallest, and it never leaves a shot at zero
 * frames the way naive truncation can.
 */
export function reconcileDurations(shots: Shot[], targetFrames: number): Shot[] {
  const total = shots.reduce((sum, s) => sum + s.duration_frames, 0);
  if (total === targetFrames || total === 0) return shots;

  const scale = targetFrames / total;
  const scaled = shots.map((shot) => ({
    ...shot,
    duration_frames: Math.max(1, Math.round(shot.duration_frames * scale)),
  }));

  const drift = targetFrames - scaled.reduce((sum, s) => sum + s.duration_frames, 0);
  if (drift === 0) return scaled;

  let longestIndex = 0;
  for (let i = 1; i < scaled.length; i++) {
    if (scaled[i]!.duration_frames > scaled[longestIndex]!.duration_frames) longestIndex = i;
  }
  const longest = scaled[longestIndex]!;
  scaled[longestIndex] = {
    ...longest,
    duration_frames: Math.max(1, longest.duration_frames + drift),
  };

  return scaled;
}

function entitySummary(bible: SceneBible) {
  return {
    characters: bible.characters.map((c) => ({
      id: c.id,
      label: c.label,
      voice_id: c.voice_id,
      forbidden_changes: c.forbidden_changes,
    })),
    products: bible.products.map((p) => ({
      id: p.id,
      label: p.label,
      critical_features: p.critical_features,
    })),
    locations: bible.locations.map((l) => ({ id: l.id, label: l.label })),
    style: bible.style,
  };
}
