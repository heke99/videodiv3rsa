---
name: "Caption Sync Judge"
version: "1.0"
category: "quality"
description: "Verify captions match the audio that will actually ship."
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
