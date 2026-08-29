"use client";

import type { TimelineView } from "@/lib/api";

/**
 * The multi-track timeline (spec section 42).
 *
 * Events are positioned from their frame or sample values converted to a
 * fraction of the total duration. The conversion happens once, here, against
 * the timebase the server sent, so the picture matches the render.
 */

const TRACK_COLORS: Record<string, string> = {
  VIDEO: "var(--track-video)",
  DIALOGUE: "var(--track-dialogue)",
  MUSIC: "var(--track-music)",
  SFX: "var(--track-sfx)",
  AMBIENCE: "var(--track-sfx)",
  ROOM_TONE: "var(--track-sfx)",
  CAPTIONS: "var(--track-captions)",
};

export function TimelineView_({
  data,
  selectedShotId,
  onSelectShot,
  onToggleMute,
}: {
  data: TimelineView;
  selectedShotId: string | null;
  onSelectShot: (shotId: string) => void;
  onToggleMute: (trackId: string, muted: boolean) => void;
}) {
  const { timeline, tracks, events } = data;

  if (!timeline) {
    return (
      <div className="card muted">The timeline appears once the first scenes have been generated.</div>
    );
  }

  const fps = timeline.frame_rate_num / timeline.frame_rate_den;
  const totalSeconds = timeline.duration_frames / fps;

  /** Where an event sits, as a fraction of the whole. */
  function span(event: TimelineView["events"][number]): { left: number; width: number } {
    const start =
      event.start_frame !== null
        ? event.start_frame / fps
        : (event.start_sample ?? 0) / timeline!.audio_sample_rate;
    const end =
      event.end_frame !== null
        ? event.end_frame / fps
        : (event.end_sample ?? 0) / timeline!.audio_sample_rate;

    return {
      left: (start / totalSeconds) * 100,
      // A clip narrower than a hairline is unclickable, so it is floored.
      width: Math.max(((end - start) / totalSeconds) * 100, 0.4),
    };
  }

  return (
    <div className="card stack" style={{ gap: "0.5rem", overflowX: "auto" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Timeline</strong>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {totalSeconds.toFixed(1)}s · {timeline.frame_rate_num}/{timeline.frame_rate_den} fps ·{" "}
          {timeline.duration_frames} frames
        </span>
      </div>

      <div style={{ minWidth: 640 }}>
        {tracks.map((track) => {
          const trackEvents = events.filter((e) => e.track_id === track.id);
          return (
            <div key={track.id} className="row" style={{ gap: "0.5rem", marginBottom: "0.35rem" }}>
              <button
                onClick={() => onToggleMute(track.id, !track.muted)}
                aria-pressed={track.muted}
                title={track.muted ? "Unmute" : "Mute"}
                style={{
                  width: 96,
                  flex: "0 0 96px",
                  fontSize: "0.75rem",
                  padding: "0.3rem 0.4rem",
                  opacity: track.muted ? 0.5 : 1,
                  textAlign: "left",
                }}
              >
                {track.kind}
              </button>

              <div
                style={{
                  position: "relative",
                  flex: 1,
                  height: 34,
                  background: "var(--surface-raised)",
                  borderRadius: 6,
                  opacity: track.muted ? 0.4 : 1,
                }}
              >
                {trackEvents.map((event) => {
                  const { left, width } = span(event);
                  const selected = event.shot_id !== null && event.shot_id === selectedShotId;
                  return (
                    <button
                      key={event.id}
                      onClick={() => event.shot_id && onSelectShot(event.shot_id)}
                      disabled={!event.shot_id}
                      title={event.text_content ?? event.slug}
                      style={{
                        position: "absolute",
                        left: `${left}%`,
                        width: `${width}%`,
                        top: 3,
                        bottom: 3,
                        height: "auto",
                        padding: "0 0.35rem",
                        fontSize: "0.7rem",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                        color: "#fff",
                        background: TRACK_COLORS[track.kind] ?? "var(--track-captions)",
                        border: selected ? "2px solid var(--text)" : "1px solid rgba(0,0,0,0.25)",
                        cursor: event.shot_id ? "pointer" : "default",
                      }}
                    >
                      {event.text_content ?? event.slug.replace(/^ev_/, "")}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
