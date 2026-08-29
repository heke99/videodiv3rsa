---
name: "Audio Repair"
version: "1.0"
category: "repair"
description: "Fix mix faults without regenerating speech."
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
