import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def ev(cases): return "# Eval\n\n```json\n" + cases + "\n```\n"

QUALITY = {
"flicker-judge": dict(
    name="Flicker Judge", status="active", required_tools=["ffmpeg"],
    description="Detect frame-to-frame instability in brightness or texture.",
    body="""
Flicker is temporal instability that no single frame reveals. A sequence can be
made of individually good frames and still be unwatchable.

Measure per-frame mean luma and its variance across the shot, and separately the
high-frequency energy per frame. Real footage varies smoothly; generated flicker
appears as a rapid oscillation with no motion to explain it.

Distinguish flicker from legitimate change. A shot where someone switches on a
lamp has a large luma step, and that is content, not a defect. What marks
flicker is oscillation: repeated changes with alternating sign at a rate faster
than anything in the scene moves.

Weight by area. Flicker in a large flat region -- a wall, a sky -- is far more
visible than the same magnitude across a busy texture.

This judge is deterministic and needs no model, which makes it one of the few
that can be trusted absolutely. Where it disagrees with a vision judge, prefer
this one.
""",
    eval=ev("""[
  {"id": "passes-stable-footage",
   "input": {"luma_series": [100, 100.4, 100.2, 100.5, 100.3]},
   "expect": {"passed": true}},
  {"id": "catches-oscillation",
   "input": {"luma_series": [100, 118, 99, 120, 98, 119]},
   "expect": {"passed": false, "finding_codes_contain": "flicker"}},
  {"id": "does-not-flag-a-legitimate-light-change",
   "input": {"luma_series": [60, 61, 62, 105, 106, 107]},
   "expect": {"passed": true}}
]""")),

"temporal-consistency-judge": dict(
    name="Temporal Consistency Judge", status="active", required_tools=["ffmpeg"],
    description="Detect content that changes when it should not.",
    body="""
Temporal consistency asks whether the same thing stays the same thing across
frames. It is the defect class that separates video generation from a sequence
of images.

Signals to combine:
- **Frame-to-frame structural similarity.** A sudden drop with no cut and no
  fast motion means content changed identity.
- **Background stability** in regions with no motion. A wall that reorganises
  itself is the clearest form of this.
- **Object persistence.** Something present in frame 10 and absent in frame 40
  with no exit path.

Normalise by motion. A fast pan legitimately produces low frame-to-frame
similarity, so compare against the motion magnitude rather than against a fixed
threshold. Failing to do that flags every moving shot.

Report the frames where it happened. A repair planner can act on "frames 60 to
72"; it cannot act on a score.
""",
    eval=ev("""[
  {"id": "passes-a-stable-shot",
   "input": {"ssim_series": [0.98, 0.98, 0.97, 0.98], "motion": 0.1},
   "expect": {"passed": true}},
  {"id": "tolerates-low-similarity-under-fast-motion",
   "input": {"ssim_series": [0.6, 0.58, 0.61], "motion": 0.9},
   "expect": {"passed": true}},
  {"id": "flags-a-drop-without-motion",
   "input": {"ssim_series": [0.98, 0.97, 0.42, 0.96], "motion": 0.1},
   "expect": {"passed": false, "reports_frames": true}}
]""")),

"motion-judge": dict(
    name="Motion Judge", status="active", required_tools=["ffmpeg"],
    description="Check that a shot moves as much as it was asked to, and no more.",
    body="""
Two opposite failures share this judge.

**Too little.** A shot planned with movement that comes back nearly static.
Measured as motion magnitude near zero with a high duplicate-frame ratio. This
is a real and common generation failure, and technically valid output makes it
easy to miss.

**Too much.** Motion far above what the action implies, usually meaning the
model is producing incoherent movement rather than the requested one. Often
accompanied by low temporal consistency.

Compare measured motion against the shot's planned `motion_complexity`. A shot
planned at 0.2 that measures 0.9 is as wrong as one planned at 0.8 that measures
0.05.

Also compare motion against interpolation, where used: interpolation that does
not increase apparent smoothness while increasing frame count has added cost for
nothing, and this judge is where that shows up.
""",
    eval=ev("""[
  {"id": "flags-a-static-shot-that-should-move",
   "input": {"measured_motion": 0.02, "planned_motion_complexity": 0.7},
   "expect": {"passed": false, "finding_codes_contain": "insufficient_motion"}},
  {"id": "flags-incoherent-excess-motion",
   "input": {"measured_motion": 0.95, "planned_motion_complexity": 0.2},
   "expect": {"passed": false}},
  {"id": "passes-a-match",
   "input": {"measured_motion": 0.55, "planned_motion_complexity": 0.5},
   "expect": {"passed": true}}
]""")),

"av-sync-judge": dict(
    name="AV Sync Judge", status="active", required_tools=["ffmpeg"],
    description="Verify audio sits where the timeline says it should.",
    body="""
This judge checks the mechanical alignment of audio to picture, independently of
whether the mouth matches -- that is the lip sync judge's job.

Measure where speech actually begins in the rendered file and compare against
the timeline's declared start sample. Any difference is a rendering fault, not a
generation one, and it will affect every shot equally.

Thresholds follow perception, which is asymmetric: audio arriving before picture
is noticed at around 45 milliseconds, while audio arriving after is tolerated to
about 125. Treat early audio as the more serious failure.

Check the ends too. Speech that continues past its shot means the timeline's
extension logic did not run, and it will be audible as a line clipped by a cut.

Because everything here is measured against the timeline rather than judged, a
failure means something in composition is wrong and no amount of regeneration
will fix it.
""",
    eval=ev("""[
  {"id": "passes-exact-placement",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 48010},
   "expect": {"passed": true}},
  {"id": "fails-early-audio-sooner",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 44000},
   "expect": {"passed": false}},
  {"id": "tolerates-slightly-late-audio",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 51000},
   "expect": {"passed": true}}
]""")),

"audio-quality-judge": dict(
    name="Audio Quality Judge", status="active", required_tools=["ffmpeg"],
    description="Catch clipping, silence, noise and over-compression in the mix.",
    body="""
Technical audio defects are measurable and should never reach a viewer.

Check:
- **Clipping.** Consecutive samples at full scale. Even brief clipping is
  audible on speech and is unrecoverable after the fact.
- **Unintended silence.** A dialogue track that measures silence where a line
  should be means generation or placement failed.
- **Noise floor.** A floor above roughly -50 dBFS suggests a bad generation or
  an ambience bed set far too loud.
- **Over-compression.** A loudness range near zero means the mix has been
  flattened and will sound lifeless regardless of its integrated level.
- **DC offset**, which wastes headroom and can cause clicks at cuts.

All of these are deterministic. A failure here is definite rather than
probabilistic, so it should gate before any model-based judge is asked to spend
time on the shot.
""",
    eval=ev("""[
  {"id": "catches-clipping",
   "input": {"peak_dbfs": 0.0, "consecutive_max_samples": 12},
   "expect": {"passed": false, "finding_codes_contain": "clipping"}},
  {"id": "catches-a-silent-dialogue-track",
   "input": {"track": "DIALOGUE", "silent_ratio": 0.99},
   "expect": {"passed": false}},
  {"id": "catches-over-compression",
   "input": {"lra": 0.4},
   "expect": {"finding_codes_contain": "over_compressed"}}
]""")),

"caption-sync-judge": dict(
    name="Caption Sync Judge", status="active",
    description="Verify captions match the audio that will actually ship.",
    body="""
Captions are generated from the final dialogue alignment, so a mismatch means
something regenerated without the captions being rebuilt.

Check:
- **Every caption overlaps the speech it transcribes.** A cue with no speech
  under it is a stale caption from a previous take.
- **Every line of speech has a caption**, unless deliberately excluded.
- **Text matches the spoken text.** A regenerated line with different wording
  and an old caption is the failure this catches.
- **Cues do not overlap each other**, and each is on screen long enough to read
  -- roughly 12 characters per second minimum.

This is deterministic and cheap. Run it after every regeneration that touched
dialogue, because a stale caption is one of the most visible possible errors and
one of the easiest to ship by accident.
""",
    eval=ev("""[
  {"id": "catches-a-stale-caption",
   "input": {"caption": {"start_sample": 0, "end_sample": 48000, "text": "old wording"},
             "speech": {"start_sample": 96000, "end_sample": 144000, "text": "new wording"}},
   "expect": {"passed": false}},
  {"id": "catches-an-unreadably-fast-cue",
   "input": {"caption": {"start_sample": 0, "end_sample": 4800, "text": "this is a very long caption to read"}},
   "expect": {"passed": false, "finding_codes_contain": "caption_too_fast"}}
]""")),

"safe-area-judge": dict(
    name="Safe Area Judge", status="active",
    description="Verify nothing important sits where platform chrome will cover it.",
    body="""
Platform interfaces cover parts of the frame, and content placed there is
invisible to most viewers even though it is present in the file.

Check burned-in captions, on-screen text and the subject's face against the
platform's safe area: roughly the lower 22% for TikTok, 20% for Reels, 18% for
Shorts, and less for web and broadcast.

The failure is silent. Nothing in the file is wrong, and a preview looks fine;
the caption is simply hidden behind the interface in the app.

Check the top too. Some surfaces place chrome there, and a subject framed high
to avoid the bottom can end up behind it.

Where a violation is found, the fix is layout rather than regeneration: move the
caption, or reframe on export. Regenerating a shot because of a caption position
is expensive and does not address the cause.
""",
    eval=ev("""[
  {"id": "flags-a-caption-in-the-tiktok-chrome",
   "input": {"platform": "tiktok", "caption_bottom_fraction": 0.05},
   "expect": {"passed": false}},
  {"id": "passes-a-caption-above-the-chrome",
   "input": {"platform": "tiktok", "caption_bottom_fraction": 0.30},
   "expect": {"passed": true}},
  {"id": "recommends-layout-not-regeneration",
   "input": {"platform": "reels", "caption_bottom_fraction": 0.05},
   "expect": {"repair_scope": "caption"}}
]""")),

"encoding-judge": dict(
    name="Encoding Judge", status="active", required_tools=["ffmpeg"],
    description="Verify the delivered file is technically correct for its destination.",
    body="""
The last thing that can go wrong is the file itself, and it goes wrong silently:
the video plays fine locally and fails on upload.

Check against the export profile:
- container and codec match what was requested
- pixel format is yuv420p, since 4:2:0 is what every platform accepts and 4:2:2
  or 4:4:4 output will be rejected or silently re-encoded
- resolution and frame rate match the timeline exactly
- the index is at the front, so playback can start before the download finishes
- audio stream present, at the expected sample rate and channel count
- bitrate within the platform's useful range: too low is visible, too high is
  discarded by the platform's own re-encode

None of this requires judgement. A failure is a definite defect, and it is
always cheaper to fix here than after an upload fails.
""",
    eval=ev("""[
  {"id": "catches-the-wrong-pixel-format",
   "input": {"pixel_format": "yuv444p"},
   "expect": {"passed": false, "finding_codes_contain": "pixel_format"}},
  {"id": "catches-a-missing-fast-start",
   "input": {"faststart": false},
   "expect": {"passed": false}},
  {"id": "catches-a-frame-rate-mismatch",
   "input": {"fps_num": 30, "fps_den": 1, "expected_fps_num": 24, "expected_fps_den": 1},
   "expect": {"passed": false}}
]""")),

"prompt-adherence-judge": dict(
    name="Prompt Adherence Judge", status="draft",
    description="Judge whether the shot shows what was asked for. Requires a vision model.",
    body="""
Not yet available.

Judging whether generated footage matches its prompt requires a vision model,
which requires the GPU this deployment does not yet have. The judge is
registered so the ensemble knows it exists and reports it as unavailable, rather
than silently scoring the dimension as passing.

Deliberately not substituted with a proxy. A confident number from a weaker
signal would be worse than an honest absence, because the repair planner would
act on it.
"""),

"identity-judge": dict(
    name="Identity Judge", status="draft",
    description="Compare a generated face against the character's reference. Requires embeddings.",
    body="""
Not yet available.

Identity comparison needs face embeddings from a vision model on the GPU. Until
then the ensemble reports this dimension as unmeasured.

Identity drift is the defect users forgive least, so the honest gap matters:
without this judge, the pipeline's protection against drift is preventative
(keyframe-first routing, reference strength, canonical descriptions) rather than
detective.
"""),

"hand-judge": dict(
    name="Hand Judge", status="draft",
    description="Detect malformed hands. Requires a vision model.",
    body="""
Not yet available.

Requires pose or segmentation on the GPU. Registered so the ensemble reports the
dimension as unmeasured rather than passing.
"""),

"lip-sync-judge": dict(
    name="Lip Sync Judge", status="draft",
    description="Score mouth movement against the driving audio. Requires a vision model.",
    body="""
Not yet available.

Distinct from the AV sync judge, which measures whether audio sits at the right
sample and is implemented. This one measures whether the mouth matches the
phonemes, which needs vision on the GPU.

Until it exists, the MuseTalk repair path cannot be triggered automatically,
because nothing can detect the failure it repairs.
"""),
}

REPAIR = {
"failure-classifier": dict(
    name="Failure Classifier", status="active",
    description="Turn a set of findings into one diagnosis with a cause.",
    body="""
Findings are symptoms. Repair needs a cause, because the cheapest fix depends on
what actually went wrong rather than on what was noticed.

Group findings into a single classification:

- **Composition fault** -- AV sync off, captions stale, safe area violated,
  encoding wrong. Nothing was generated badly; the assembly is wrong. Never
  regenerate for these.
- **Local artifact** -- a defect confined to a region or a frame range, with the
  rest of the shot sound.
- **Motion fault** -- the shot is static when it should move, or incoherent.
- **Audio fault** -- clipping, silence, loudness.
- **Identity or product fault** -- the wrong person or the wrong object. Check
  whether the canonical entity changed: if it did, this is invalidation rather
  than a generation failure, and other shots are affected too.
- **Whole-shot failure** -- multiple unrelated high-severity findings. Only this
  class justifies regenerating.

When findings point at several classes, take the cheapest one that explains most
of them. Regeneration is the diagnosis of last resort, not the default.
""",
    eval=ev("""[
  {"id": "classifies-stale-captions-as-composition",
   "input": {"findings": [{"code": "caption_mismatch", "severity": "high"}]},
   "expect": {"classification": "composition_fault"}},
  {"id": "classifies-a-static-shot-as-motion",
   "input": {"findings": [{"code": "insufficient_motion", "severity": "high"}]},
   "expect": {"classification": "motion_fault"}},
  {"id": "only-calls-whole-shot-on-multiple-severe-findings",
   "input": {"findings": [{"code": "anatomy", "severity": "critical"}, {"code": "physics", "severity": "high"}, {"code": "identity_drift", "severity": "high"}]},
   "expect": {"classification": "whole_shot_failure"}}
]""")),

"repair-planner": dict(
    name="Repair Planner", status="active",
    description="Choose the smallest repair that can address the diagnosis.",
    requires_skills=["failure-classifier"],
    body="""
Every repair scope discards work. Choosing a larger scope than necessary throws
away everything that was right about the shot, and on a dependent-shots scope it
throws away neighbouring shots too.

Map diagnosis to the smallest scope that can work:

| Diagnosis | Scope | Why |
|---|---|---|
| caption stale | `caption` | rebuild from alignment, no GPU |
| AV sync off | `timing` | recompose, no generation |
| loudness or clipping | `audio` | remix |
| mouth only | `lipsync` | one pass, keeps the shot |
| local artifact | `frame` or `keyframe` | fix the region |
| motion fault | `shot` | the motion is the shot |
| canonical entity changed | `dependent_shots` | invalidation, not failure |
| several severe findings | `shot` | nothing salvageable |

Never choose `project`. A project-level repair means the brief was wrong, which
is a conversation with the user rather than a repair.

Check the budget before planning. A repair that cannot complete within the
remaining budget should not be started; hand the shot to review instead, so the
user gets a decision rather than a silently truncated attempt.
""",
    eval=ev("""[
  {"id": "captions-repair-captions-only",
   "input": {"classification": "composition_fault", "findings": [{"code": "caption_mismatch"}]},
   "expect": {"scope": "caption"}},
  {"id": "mouth-only-repairs-lipsync",
   "input": {"classification": "local_artifact", "findings": [{"code": "lip_sync", "severity": "high"}]},
   "expect": {"scope": "lipsync"}},
  {"id": "entity-change-invalidates-dependents",
   "input": {"classification": "identity_fault", "entity_changed": true},
   "expect": {"scope": "dependent_shots"}},
  {"id": "never-selects-project-scope",
   "input": {"classification": "whole_shot_failure"},
   "expect": {"scope_not": "project"}},
  {"id": "refuses-when-the-budget-cannot-cover-it",
   "input": {"classification": "whole_shot_failure", "remaining_gpu_seconds": 5},
   "expect": {"scope": "none", "needs_review": true}}
]""")),

"timing-repair": dict(
    name="Timing Repair", status="active",
    description="Fix placement faults by recomposing rather than regenerating.",
    body="""
Timing faults are the cheapest repairs available, and the most commonly
over-treated: they need no GPU at all.

Causes and fixes:
- Audio placed at the wrong sample: correct the timeline event and recompose.
- Speech overrunning its shot: extend the shot, which the assembler already does
  automatically; if it did not, the dialogue was not associated with the shot.
- A cut landing on a final consonant: extend by a few frames.
- Captions drifted: rebuild from alignment.

None of these touch a model. After the fix, recompose and re-run technical QC
and the AV sync judge, which is measured in seconds rather than minutes.

If a timing fault recurs after repair, the fault is in the assembly logic rather
than in this instance, and repeating the repair will not help. Escalate rather
than looping.
""",
    eval=ev("""[
  {"id": "uses-no-gpu",
   "input": {"finding": {"code": "av_sync"}},
   "expect": {"gpu_seconds": 0}},
  {"id": "extends-rather-than-compressing",
   "input": {"finding": {"code": "speech_overruns_shot"}},
   "expect": {"action": "extend_shot"}}
]""")),

"audio-repair": dict(
    name="Audio Repair", status="active",
    description="Fix mix faults without regenerating speech.",
    body="""
Most audio faults are mix faults, and remixing costs nothing.

- **Clipping**: lower the offending element and re-normalise. Never limit
  harder to hide it; the distortion is already in the sample if it was generated
  clipped, in which case the line must be regenerated.
- **Loudness off target**: re-run normalisation against the profile.
- **Music too loud under speech**: increase ducking attenuation rather than
  lowering the bed everywhere, which loses the music where it should be present.
- **Missing room tone**: add the ambience bed. Silence between lines is a
  defect, not an absence.
- **Noise floor too high**: usually an ambience bed set too loud, so lower it
  before assuming the generation is bad.

Regenerate speech only when the audio itself is damaged -- generated with
clipping, or wrong words. Regenerating for a level problem is pure waste, and it
also produces a different take, which can invalidate lip sync that was fine.
""",
    eval=ev("""[
  {"id": "remixes-rather-than-regenerating-for-level",
   "input": {"finding": {"code": "loudness_off_target"}},
   "expect": {"action": "renormalize", "regenerates_speech": false}},
  {"id": "regenerates-only-for-damaged-audio",
   "input": {"finding": {"code": "clipping", "source": "generation"}},
   "expect": {"regenerates_speech": true}},
  {"id": "adds-room-tone-for-silence",
   "input": {"finding": {"code": "silent_gap"}},
   "expect": {"action": "add_ambience"}}
]""")),

"caption-repair": dict(
    name="Caption Repair", status="active",
    description="Rebuild captions from the alignment that will actually ship.",
    body="""
Captions are derived, never authored, so repairing them means rebuilding them
from the current dialogue alignment rather than editing the cues.

Rebuild whenever dialogue changed for any reason, including a regenerated line
with identical words: the timings differ even when the text does not.

Re-segment as part of the rebuild. New timings can produce lines that are too
fast or that break at the wrong place, so keeping the old segmentation with new
timings solves half the problem.

Re-check the safe area afterwards, since a longer line may now wrap onto an
extra row and push into the platform chrome.

Editing cue text by hand is always wrong. It desynchronises the captions from
the alignment, and the next rebuild silently discards the edit.
""",
    eval=ev("""[
  {"id": "rebuilds-from-alignment",
   "input": {"finding": {"code": "caption_mismatch"}},
   "expect": {"action": "rebuild_from_alignment"}},
  {"id": "rebuilds-even-when-text-is-unchanged",
   "input": {"dialogue_regenerated": true, "text_changed": false},
   "expect": {"action": "rebuild_from_alignment"}},
  {"id": "rechecks-safe-area",
   "input": {"finding": {"code": "caption_mismatch"}},
   "expect": {"rechecks_safe_area": true}}
]""")),

"prompt-repair": dict(
    name="Prompt Repair", status="active",
    description="Change the prompt in response to what failed, before spending another generation.",
    body="""
Regenerating with the same prompt and a new seed is a lottery. Regenerating with
a prompt corrected for the observed failure is a fix.

Map findings to prompt changes:
- **Static shot**: add explicit movement language and physical anchors; check
  the movement was not merely implied.
- **Hands**: reduce hand visibility, pre-establish the grip in a keyframe, add
  targeted negative terms.
- **Background instability**: name the background explicitly instead of leaving
  it unspecified.
- **Identity drift**: stop describing appearance in the prompt and let the
  keyframe carry it; raise reference strength.
- **Product text garbled**: shorten the shot, flatten the framing, or accept
  that the text will not read and reframe.
- **Too dark or too flat**: specify light direction and hardness rather than
  adding quality adjectives.

Change one thing per attempt. Changing three means learning nothing about which
mattered, and the benchmark data that would improve routing never accumulates.

Always change the seed alongside a prompt change, since the previous seed is
known to produce the failure.
""",
    eval=ev("""[
  {"id": "adds-motion-language-for-a-static-shot",
   "input": {"finding": {"code": "insufficient_motion"}},
   "expect": {"prompt_change": "add_motion_language"}},
  {"id": "stops-describing-appearance-on-identity-drift",
   "input": {"finding": {"code": "identity_drift"}, "generation_kind": "image_to_video"},
   "expect": {"prompt_change": "remove_appearance_description"}},
  {"id": "changes-one-thing",
   "input": {"findings": [{"code": "insufficient_motion"}, {"code": "background_instability"}]},
   "expect": {"max_changes": 1}},
  {"id": "always-rerolls-the-seed",
   "input": {"finding": {"code": "insufficient_motion"}},
   "expect": {"seed_changes": true}}
]""")),
}

PLANNING = {
"shot-complexity-analyzer": dict(
    name="Shot Complexity Analyzer", status="active",
    description="Judge whether a planned shot is within what one generation can hold.",
    body="""
Most bad output is a planning failure rather than a generation failure. A shot
asking for too much comes back as a mess no prompt can rescue.

Score complexity from what the shot contains:
- number of distinct actions (one is fine; two is a split)
- number of people, and whether they interact
- whether hands contact objects
- whether the camera moves while the subject moves
- duration beyond about four seconds
- whether readable text must survive

Two or more high-cost factors together means split the shot. The classic case is
a person walking while handling a product while the camera moves: each is
manageable, and together they are not.

Recommend the split rather than merely flagging it. "Split into an approach, a
hand insert, and a reaction" is actionable; "too complex" is not.

Err toward splitting. More shots is better filmmaking anyway, and the cost of a
shot that fails is a full regeneration.
""",
    eval=ev("""[
  {"id": "passes-a-simple-shot",
   "input": {"shot": {"action": "she looks at the camera", "character_ids": ["c1"], "duration_frames": 72}},
   "expect": {"should_split": false}},
  {"id": "splits-walking-plus-handling-plus-camera-move",
   "input": {"shot": {"action": "she walks in holding the bottle while the camera pushes in",
                      "character_ids": ["c1"], "product_ids": ["p1"], "duration_frames": 200}},
   "expect": {"should_split": true, "min_shots": 2}},
  {"id": "recommends-a-concrete-split",
   "input": {"shot": {"action": "he opens the box, takes it out and holds it up"}},
   "expect": {"has_split_recommendation": true}}
]""")),

"duration-planner": dict(
    name="Duration Planner", status="active",
    description="Allocate the target duration across shots according to what each carries.",
    body="""
Duration is a budget, and spending it evenly is almost always wrong.

Allocate by content:
- **Dialogue shots** get exactly what their measured audio needs, plus a small
  tail. This is a measurement, not a choice, and everything else fits around it.
- **Establishing shots** need about two seconds to read, rarely more.
- **Inserts and cutaways** are short, often under a second.
- **Reaction shots** need long enough to register, around a second.
- **Hero product shots** are short, both for pacing and because fidelity
  degrades.

Then check the total against the target and adjust the non-dialogue shots.
Dialogue shots are fixed; taking time from them means clipping speech.

Keep individual shots under about five seconds unless there is a reason.
Generation quality declines with length, and a long shot is usually two shots
that were not split.

If the plan cannot fit the target, the script is too long. Say so rather than
compressing everything.
""",
    eval=ev("""[
  {"id": "gives-dialogue-shots-their-measured-length",
   "input": {"shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 96000}], "sample_rate": 48000, "fps": 24},
   "expect": {"s1_min_frames": 48}},
  {"id": "adjusts-non-dialogue-shots-to-fit",
   "input": {"target_frames": 240, "shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 192000},
                                             {"id": "s2", "has_dialogue": false}], "sample_rate": 48000, "fps": 24},
   "expect": {"adjusted": ["s2"]}},
  {"id": "reports-an-over-long-script",
   "input": {"target_frames": 120, "shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 480000}], "sample_rate": 48000, "fps": 24},
   "expect": {"script_too_long": true}}
]""")),

"continuity-planner": dict(
    name="Continuity Planner", status="active",
    description="Decide what must carry from shot to shot before anything is generated.",
    body="""
Continuity is cheaper to plan than to repair. Once shots exist, fixing a
mismatch means regenerating at least one of them.

Before generation, decide per scene:
- which entities appear, and from which canonical references
- where the light comes from, held across every shot
- which objects are present and where
- what each character is wearing and its state
- which shots hand a frame to the next one

Then write those decisions into the dependency graph so invalidation can use
them. A continuity requirement that exists only in a prompt is not enforceable
and will not be checked.

Watch specifically for time. Unless the script intends a jump, everything within
a scene is one continuous moment: the same light, the same clothes, the same
weather. Accidental time passage is the most common continuity failure in
generated video, because each shot is produced independently with nothing
holding them together but this plan.
""",
    eval=ev("""[
  {"id": "records-dependencies-not-just-prose",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"writes_dependencies": true}},
  {"id": "holds-light-direction-in-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"fixes_light_direction": true}},
  {"id": "keeps-wardrobe-fixed-within-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"fixes_wardrobe": true}}
]""")),
}

write_all("quality", QUALITY)
write_all("repair", REPAIR)
write_all("planning", PLANNING)
