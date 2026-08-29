---
name: "Audio Quality Judge"
version: "1.0"
category: "quality"
description: "Catch clipping, silence, noise and over-compression in the mix."
status: "active"
required_tools: ["ffmpeg"]
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

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
