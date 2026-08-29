---
name: "Lip Sync Planner"
version: "1.0"
category: "audio"
description: "Prepare the inputs a speech-driven shot needs to sync correctly."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Lip sync is decided before generation, by what the model is given.

The requirements:
- **Final audio, not a draft.** The line that will ship must be the line that
  drives the video, or every regeneration of the audio invalidates the picture.
- **Alignment computed and attached.** Word and phoneme timings let the repair
  path work later; without them a lip sync failure can be detected but not
  fixed.
- **The face large enough.** Below roughly a fifth of frame height there is not
  enough resolution for mouth detail, and sync will read as wrong however good
  the model is.
- **The mouth unobstructed.** A hand near the face, a microphone, hair across
  the mouth: all of these break sync and none are recoverable.

Plan the shot around these rather than fixing afterwards. A close enough,
unobstructed, correctly driven shot syncs; the repair path exists for when it
does not, and it is more expensive than getting it right.

Never let picture be generated before the audio it must match. That ordering
error is the most expensive one available here.
