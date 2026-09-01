import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ApplicationFailure } from "@temporalio/activity";
import type { MediaMetadata } from "@videoai/assets";
import { config } from "@videoai/config";
import type { RoutableKind, RoutingDecision } from "@videoai/contracts";
import { availableProfiles } from "@videoai/gpu-manager";
import { loadRoutableModels, loadRoutingRules, route } from "@videoai/models";
import { probe } from "@videoai/render";
import { composeInstructions, loadCatalogue, selectSkills, type SkillPackage } from "@videoai/skills";

/**
 * The pieces the non-shot generation stages share.
 *
 * Speech, alignment and ambience are routed through the same registry and the
 * same rules as a shot, they are just not shots: they have no frame count and
 * no camera. Everything that made `generateShot` work and does not depend on
 * being a shot lives here, so the three of them cannot drift apart.
 */

/**
 * The skill catalogue, read from disk once per process.
 *
 * Held as the promise rather than the value so concurrent activities share one
 * read, and kept as a rejected promise on failure so a broken catalogue is
 * reported every time instead of silently retrying the filesystem under every
 * job.
 */
let catalogue: Promise<Map<string, SkillPackage>> | null = null;
export function skillCatalogue(): Promise<Map<string, SkillPackage>> {
  return (catalogue ??= loadCatalogue(config().SKILLS_ROOT));
}

/**
 * A routing decision for work that is not a shot.
 *
 * The same router, deliberately. Speech and ambience come from models under the
 * same licence gate, the same profile check and the same rules table as the
 * picture, and a second code path would be a second place for an unreviewed
 * model to slip through.
 */
export async function routeSupport(
  kind: RoutableKind,
  qualityMode: string,
  overrides: { has_dialogue?: boolean } = {},
): Promise<RoutingDecision> {
  const [rules, models, profiles] = await Promise.all([
    loadRoutingRules(),
    loadRoutableModels(),
    availableProfiles(),
  ]);

  return route(
    {
      generation_kind: kind,
      quality_mode: qualityMode as never,
      // Not measured in frames. The router skips its duration check on zero.
      duration_frames: 0,
      resolution: { width: 1, height: 1 },
      human_count: 0,
      has_dialogue: overrides.has_dialogue ?? false,
      has_reference_images: false,
      motion_complexity: 0,
      continuity_requirement: 0,
      requires_product_fidelity: false,
      requires_identity_lock: false,
      available_profiles: profiles,
    },
    { rules, models },
  );
}

export interface Guidance {
  instructions: string;
  skill_versions: Record<string, string>;
}

/** Skill instructions for a stage, and the versions to record in provenance. */
export async function guidanceFor(
  kind: RoutableKind,
  qualityMode: string,
  required: string[],
  selection: { has_dialogue?: boolean; has_humans?: boolean } = {},
): Promise<Guidance> {
  const selected = selectSkills(
    { quality_mode: qualityMode, generation_kind: kind, required, ...selection },
    await skillCatalogue(),
  );
  return {
    instructions: composeInstructions(selected),
    skill_versions: Object.fromEntries(selected.map((s) => [s.skill_id, s.descriptor.version])),
  };
}

/**
 * Measure audio a worker produced, rather than believing the request.
 *
 * `assembleTimeline` extends a shot to hold its speech, and the rule it applies
 * is that measured audio wins over the plan. It can only do that if something
 * measured, and this is the only place that does.
 */
export async function measureAudio(body: Uint8Array): Promise<MediaMetadata> {
  const file = path.join(tmpdir(), `videoai-measure-${digest(body.byteLength, Date.now())}.wav`);
  await writeFile(file, body);
  try {
    const result = await probe(file);
    if (!result.container_ok || result.audio_sample_rate === null || result.duration_seconds === null) {
      throw ApplicationFailure.nonRetryable(
        "The worker returned audio ffprobe cannot read, so its length is unknown. Placing it on " +
          "the timeline at a guessed length is the one thing timeline assembly exists to prevent.",
        "UnreadableAudio",
      );
    }
    return {
      duration_samples: Math.round(result.duration_seconds * result.audio_sample_rate),
      audio_sample_rate: result.audio_sample_rate,
      audio_channels: result.audio_channels,
      audio_codec: result.audio_codec,
    };
  } finally {
    await unlink(file).catch(() => {});
  }
}

/** A short, stable digest of whatever makes one unit of work different from another. */
export function digest(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 16);
}
