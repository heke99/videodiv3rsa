import { ApplicationFailure } from "@temporalio/activity";
import type { AspectRatio, DialogueLine, SceneBible, Script, VoiceProfile } from "@videoai/contracts";
import { DialogueAlignment, EXPORT_PRESETS, WordTiming } from "@videoai/contracts";
import { queryOne } from "@videoai/database";
import { storage } from "@videoai/storage";

import { jobContext, type JobContext } from "./delivery.js";
import { dispatch } from "./generate.js";
import { digest, guidanceFor, measureAudio, routeSupport } from "./support.js";

/**
 * Speech, its alignment, and the ambience under it (spec sections 19, 20, 24).
 *
 * These three ran nowhere. The production workflow calls the first of them on
 * the line immediately after routing, so every run has died there and nothing
 * downstream -- shot generation, timeline assembly, the compositor, export --
 * has ever been reached by a real job.
 *
 * They are one file because they are one chain: the TTS output is what the
 * aligner is given, the alignment is what the timeline and the captions are
 * built from, and the ambience is placed under both.
 */

export interface DialogueOutput {
  dialogue_line_id: string;
  asset_id: string;
  /** Measured from the produced audio, never taken from the request. */
  length_samples: number;
  /** Carried forward so the aligner has the transcript to align against. */
  text: string;
}

/**
 * Generate every spoken line in the film.
 *
 * Narration first, then dialogue, which is the order they are read in. Each
 * line is a separate unit of work with its own idempotency key, so a job that
 * crashes after line nine resumes at line ten rather than re-speaking the film.
 *
 * The voice comes from the Scene Bible and nowhere else. `VoiceProfile` fixes
 * the model, the version and the seed, which is what makes a character sound
 * like the same person in shot twelve as in shot one; deriving a seed here
 * would undo that on the first retry.
 */
export async function generateDialogue(input: {
  job_id: string;
  script: Script;
  bible: SceneBible;
}): Promise<DialogueOutput[]> {
  const lines = [...input.script.narration, ...input.script.dialogue];
  if (lines.length === 0) return [];

  const ctx = await jobContext(input.job_id);
  const voices = new Map(input.bible.voices.map((v) => [v.id, v]));
  const decision = await routeSupport("text_to_speech", ctx.quality_mode, { has_dialogue: true });
  const guidance = await guidanceFor("text_to_speech", ctx.quality_mode, decision.skills, {
    has_dialogue: true,
  });

  const outputs: DialogueOutput[] = [];
  for (const line of lines) {
    const voice = voices.get(line.voice_id);
    if (!voice) {
      // Silently substituting a voice would change who is speaking, which is
      // exactly the kind of drift the Scene Bible exists to prevent.
      throw ApplicationFailure.nonRetryable(
        `Dialogue line ${line.id} asks for voice ${line.voice_id}, which the Scene Bible does not define.`,
        "UnknownVoice",
      );
    }

    const output = await dispatch({
      job_id: input.job_id,
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      attempt: 1,
      // Covers everything that would change the audio: the words, the delivery
      // and the voice identity. Same line, same voice, same bytes on a replay.
      idempotency_key: `${input.job_id}:tts:${line.id}:${digest(
        line.text,
        line.emotion,
        voice.id,
        voice.model_version,
        voice.seed,
        voice.speech_rate,
      )}`,
      decision,
      request: {
        shot_id: null,
        model_id: decision.model_id,
        model_version: decision.model_version,
        precision: decision.precision,
        prompt: line.text,
        negative_prompt: "",
        // A cloned voice is driven by its recorded reference, which is the
        // asset the rights declaration was made against.
        references: voice.reference_asset_ids.map((assetId) => ({
          role: "voice_reference",
          asset: { asset_id: assetId },
          strength: 1,
        })),
        driving_audio: null,
        seed: voice.seed,
        resolution: resolutionOf(ctx),
        settings: voiceSettings(line, voice, ctx, guidance.instructions),
      },
      asset: { kind: "audio", role: "dialogue", mime: "audio/wav", extension: ".wav" },
      provenance: { skill_versions: guidance.skill_versions },
      measure: measureAudio,
    });

    outputs.push({
      dialogue_line_id: line.id,
      asset_id: output.asset_id,
      // Read back rather than kept from the measurement, so a replayed
      // dispatch -- which returns the first generation without regenerating --
      // reports the length that was actually stored.
      length_samples: await storedLength(output.asset_id, line.id),
      text: line.text,
    });
  }

  return outputs;
}

/**
 * Align each spoken line to its own audio, and record the timings.
 *
 * This is what makes captions real. `captionsFromAlignment` derives them from
 * word timings and `buildTimeline` reads `dialogue_alignments`; both have been
 * written and correct for several batches with nothing ever writing a row for
 * them to read.
 *
 * The alignment document is stored as an asset in its own right and related to
 * the audio with `alignment_of`, so "what were these timings measured from" is
 * answerable later. That relationship has been in the schema's enum from the
 * start and nothing has ever written one.
 */
export async function alignDialogue(input: {
  job_id: string;
  dialogue: Array<{ dialogue_line_id: string; asset_id: string; text: string }>;
}): Promise<Array<{ dialogue_line_id: string; alignment_id: string }>> {
  if (input.dialogue.length === 0) return [];

  const ctx = await jobContext(input.job_id);
  const decision = await routeSupport("alignment", ctx.quality_mode, { has_dialogue: true });
  const guidance = await guidanceFor("alignment", ctx.quality_mode, decision.skills, {
    has_dialogue: true,
  });

  const results: Array<{ dialogue_line_id: string; alignment_id: string }> = [];
  for (const line of input.dialogue) {
    const output = await dispatch({
      job_id: input.job_id,
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      attempt: 1,
      idempotency_key: `${input.job_id}:align:${line.dialogue_line_id}:${digest(line.asset_id, line.text)}`,
      decision,
      request: {
        shot_id: null,
        model_id: decision.model_id,
        model_version: decision.model_version,
        precision: decision.precision,
        // The transcript is what the aligner aligns to. Asking it to
        // transcribe as well would let a mishearing rewrite the script.
        prompt: line.text,
        negative_prompt: "",
        references: [],
        driving_audio: { asset_id: line.asset_id },
        seed: 0,
        resolution: resolutionOf(ctx),
        settings: {
          audio_sample_rate: ctx.timebase.audio_sample_rate,
          skill_instructions: guidance.instructions,
        },
      },
      asset: {
        kind: "document",
        role: "alignment",
        mime: "application/json",
        extension: ".json",
      },
      provenance: { skill_versions: guidance.skill_versions },
      derived_from: { asset_id: line.asset_id, relationship: "alignment_of" },
    });

    const timings = parseAlignment(await storage().get(output.storage_key), line.dialogue_line_id);
    const row = await queryOne<{ id: string }>(
      `insert into public.dialogue_alignments
         (project_id, organization_id, dialogue_line_id, asset_id, audio_sample_rate, words, phonemes)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (project_id, dialogue_line_id, asset_id) do update
         set words = excluded.words,
             phonemes = excluded.phonemes,
             audio_sample_rate = excluded.audio_sample_rate
       returning id`,
      [
        ctx.project_id,
        ctx.organization_id,
        line.dialogue_line_id,
        // The audio, not the alignment document: the timings describe that
        // file, and `buildTimeline` joins through this column to read its
        // measured length.
        line.asset_id,
        ctx.timebase.audio_sample_rate,
        JSON.stringify(timings.words),
        JSON.stringify(timings.phonemes),
      ],
    );
    if (!row) {
      throw ApplicationFailure.nonRetryable(`Could not record the alignment for ${line.dialogue_line_id}`);
    }
    results.push({ dialogue_line_id: line.dialogue_line_id, alignment_id: row.id });
  }

  return results;
}

/**
 * Room tone and ambience, derived from the finished picture.
 *
 * Generated per shot from the shot's own approved take, because ambience that
 * does not follow the cut is worse than none. The bed is placed at the shot's
 * start by timeline assembly rather than at an offset computed here: dialogue
 * may already have made an earlier shot longer, and only assembly knows that.
 */
export async function generateAmbience(input: {
  job_id: string;
  shots: Array<{ shot_id: string; asset_id: string }>;
}): Promise<{ asset_ids: string[] }> {
  if (input.shots.length === 0) return { asset_ids: [] };

  const ctx = await jobContext(input.job_id);
  const decision = await routeSupport("video_to_audio", ctx.quality_mode);
  const guidance = await guidanceFor("video_to_audio", ctx.quality_mode, decision.skills);

  const assetIds: string[] = [];
  for (const shot of input.shots) {
    const output = await dispatch({
      job_id: input.job_id,
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      shot_slug: shot.shot_id,
      attempt: 1,
      idempotency_key: `${input.job_id}:ambience:${shot.shot_id}:${digest(shot.asset_id)}`,
      decision,
      request: {
        shot_id: shot.shot_id,
        model_id: decision.model_id,
        model_version: decision.model_version,
        precision: decision.precision,
        prompt: "",
        negative_prompt: "speech, dialogue, music, narration",
        references: [{ role: "source_video", asset: { asset_id: shot.asset_id }, strength: 1 }],
        driving_audio: null,
        seed: 0,
        fps_num: ctx.timebase.frame_rate.num,
        fps_den: ctx.timebase.frame_rate.den,
        resolution: resolutionOf(ctx),
        settings: {
          audio_sample_rate: ctx.timebase.audio_sample_rate,
          skill_instructions: guidance.instructions,
        },
      },
      asset: { kind: "audio", role: "ambience", mime: "audio/wav", extension: ".wav" },
      provenance: { skill_versions: guidance.skill_versions },
      derived_from: { asset_id: shot.asset_id, relationship: "derived_from" },
      measure: measureAudio,
    });
    assetIds.push(output.asset_id);
  }

  return { asset_ids: assetIds };
}

// -- helpers ----------------------------------------------------------------

function resolutionOf(ctx: JobContext): { width: number; height: number } {
  const preset = EXPORT_PRESETS[ctx.aspect_ratio as AspectRatio];
  if (!preset) {
    throw ApplicationFailure.nonRetryable(`No resolution for aspect ratio ${ctx.aspect_ratio}`);
  }
  return { width: preset.width, height: preset.height };
}

/**
 * Everything the adapter needs to say this line in this voice.
 *
 * The whole `VoiceProfile` travels rather than a summary of it: which of these
 * a given TTS runtime honours is the adapter's business, and dropping fields
 * here would silently flatten an accent or a speaking rate that the Scene Bible
 * was explicit about.
 */
function voiceSettings(
  line: DialogueLine,
  voice: VoiceProfile,
  ctx: JobContext,
  instructions: string,
): Record<string, unknown> {
  return {
    voice_id: voice.id,
    speaker_profile: voice.speaker_profile,
    language: voice.language,
    accent: voice.accent,
    style: voice.style,
    voice_model: voice.voice_model,
    speech_rate: voice.speech_rate,
    emotion: line.emotion,
    pause_before_ms: line.pause_before_ms,
    pause_after_ms: line.pause_after_ms,
    pronunciation_hints: line.pronunciation_hints,
    audio_sample_rate: ctx.timebase.audio_sample_rate,
    skill_instructions: instructions,
  };
}

/** The measured length recorded on the asset, which is what the timeline reads. */
async function storedLength(assetId: string, lineId: string): Promise<number> {
  const row = await queryOne<{ duration_samples: string | null }>(
    `select v.duration_samples
     from public.asset_versions v
     join public.assets a on a.id = v.asset_id and a.current_version = v.version
     where v.asset_id = $1`,
    [assetId],
  );
  if (!row?.duration_samples) {
    throw ApplicationFailure.nonRetryable(
      `The audio for ${lineId} was stored without a measured length, so the timeline cannot place it.`,
      "UnmeasuredAudio",
    );
  }
  return Number(row.duration_samples);
}

/**
 * Read the aligner's output, and refuse it if it is not what it claims.
 *
 * Word timings become caption cue points and drive the lipsync repair, so a
 * malformed one is not a field to default away: it would put subtitles under
 * the wrong words for the rest of the film.
 */
function parseAlignment(
  body: Uint8Array,
  lineId: string,
): Pick<import("@videoai/contracts").DialogueAlignment, "words" | "phonemes"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch (error) {
    throw ApplicationFailure.nonRetryable(
      `The alignment for ${lineId} is not JSON: ${(error as Error).message}`,
      "MalformedAlignment",
    );
  }

  const document = parsed as { words?: unknown; phonemes?: unknown };
  const words = WordTiming.array().safeParse(document.words ?? []);
  if (!words.success) {
    throw ApplicationFailure.nonRetryable(
      `The alignment for ${lineId} has unusable word timings: ${words.error.message}`,
      "MalformedAlignment",
    );
  }

  const phonemes = DialogueAlignment.shape.phonemes.safeParse(document.phonemes ?? []);
  if (!phonemes.success) {
    throw ApplicationFailure.nonRetryable(
      `The alignment for ${lineId} has unusable phoneme timings: ${phonemes.error.message}`,
      "MalformedAlignment",
    );
  }

  return { words: words.data, phonemes: phonemes.data };
}
