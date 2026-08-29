import type { Timeline, TimelineEvent } from "@videoai/contracts";

/**
 * Timeline diffing.
 *
 * Two uses: the editor's undo/redo needs to know what a command changed, and
 * after a regeneration the user needs to see what moved. Both want the same
 * answer, so it lives in one place.
 */

export interface TimelineChange {
  kind: "added" | "removed" | "moved" | "retimed" | "replaced" | "gain";
  event_id: string;
  track_id: string;
  detail: string;
}

export interface TimelineDiff {
  changes: TimelineChange[];
  duration_frames_before: number;
  duration_frames_after: number;
  /** True when nothing about the rendered result would differ. */
  identical: boolean;
}

export function diffTimelines(before: Timeline, after: Timeline): TimelineDiff {
  const beforeById = new Map(before.events.map((e) => [e.id, e]));
  const afterById = new Map(after.events.map((e) => [e.id, e]));
  const changes: TimelineChange[] = [];

  for (const [id, event] of beforeById) {
    if (!afterById.has(id)) {
      changes.push({
        kind: "removed",
        event_id: id,
        track_id: event.track_id,
        detail: describe(event),
      });
    }
  }

  for (const [id, next] of afterById) {
    const previous = beforeById.get(id);
    if (!previous) {
      changes.push({
        kind: "added",
        event_id: id,
        track_id: next.track_id,
        detail: describe(next),
      });
      continue;
    }
    changes.push(...compare(previous, next));
  }

  return {
    changes,
    duration_frames_before: before.duration_frames,
    duration_frames_after: after.duration_frames,
    identical: changes.length === 0 && before.duration_frames === after.duration_frames,
  };
}

function compare(before: TimelineEvent, after: TimelineEvent): TimelineChange[] {
  const changes: TimelineChange[] = [];
  const track = after.track_id;

  if (before.kind !== after.kind) {
    return [{ kind: "replaced", event_id: after.id, track_id: track, detail: "event kind changed" }];
  }

  if (before.kind !== "caption" && after.kind !== "caption") {
    if (before.asset.asset_id !== after.asset.asset_id) {
      changes.push({
        kind: "replaced",
        event_id: after.id,
        track_id: track,
        // The most common real change: a shot was regenerated and now points
        // at a different take.
        detail: `asset ${before.asset.asset_id} to ${after.asset.asset_id}`,
      });
    }
  }

  if (before.kind === "video" && after.kind === "video") {
    if (before.start_frame !== after.start_frame) {
      changes.push({
        kind: "moved",
        event_id: after.id,
        track_id: track,
        detail: `frame ${before.start_frame} to ${after.start_frame}`,
      });
    }
    const beforeLength = before.end_frame - before.start_frame;
    const afterLength = after.end_frame - after.start_frame;
    if (beforeLength !== afterLength) {
      changes.push({
        kind: "retimed",
        event_id: after.id,
        track_id: track,
        detail: `${beforeLength} to ${afterLength} frames`,
      });
    }
  }

  if (before.kind !== "video" && after.kind !== "video") {
    if (before.start_sample !== after.start_sample) {
      changes.push({
        kind: "moved",
        event_id: after.id,
        track_id: track,
        detail: `sample ${before.start_sample} to ${after.start_sample}`,
      });
    }
    const beforeLength = before.end_sample - before.start_sample;
    const afterLength = after.end_sample - after.start_sample;
    if (beforeLength !== afterLength) {
      changes.push({
        kind: "retimed",
        event_id: after.id,
        track_id: track,
        detail: `${beforeLength} to ${afterLength} samples`,
      });
    }
  }

  if (before.kind === "audio" && after.kind === "audio" && before.gain_db !== after.gain_db) {
    changes.push({
      kind: "gain",
      event_id: after.id,
      track_id: track,
      detail: `${before.gain_db} dB to ${after.gain_db} dB`,
    });
  }

  if (before.kind === "caption" && after.kind === "caption" && before.text !== after.text) {
    changes.push({
      kind: "replaced",
      event_id: after.id,
      track_id: track,
      detail: "caption text changed",
    });
  }

  return changes;
}

function describe(event: TimelineEvent): string {
  if (event.kind === "video") return `frames ${event.start_frame}-${event.end_frame}`;
  return `samples ${event.start_sample}-${event.end_sample}`;
}

/**
 * A human sentence for the editor. Undo history is only useful if a user can
 * tell what they are undoing.
 */
export function summariseDiff(diff: TimelineDiff): string {
  if (diff.identical) return "No change";

  const counts = new Map<TimelineChange["kind"], number>();
  for (const change of diff.changes) {
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  }

  const parts = [...counts.entries()].map(([kind, n]) => `${n} ${kind}`);
  const duration =
    diff.duration_frames_before === diff.duration_frames_after
      ? ""
      : `, duration ${diff.duration_frames_before} to ${diff.duration_frames_after} frames`;

  return `${parts.join(", ")}${duration}`;
}
