---
name: "Physical Camera Behaviour"
version: "1.0"
category: "realism"
description: "Include the artifacts a real lens and sensor produce."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["REALISTIC", "CINEMATIC", "ULTRA"]
generation_kinds: []
---

Real cameras are imperfect instruments, and their imperfections are load-bearing
signals of authenticity.

Where the shot warrants it, include:

- **Motion blur** consistent with the movement and shutter. Perfectly crisp
  fast motion is a giveaway; every frame sharp during a quick pan is impossible.
- **Focus breathing** -- the frame shifts very slightly during a focus change.
- **Falloff toward the corners**, both in brightness and sharpness.
- **Highlight rolloff** -- real sensors clip gradually, not abruptly.
- **Fine grain**, matched to the implied light level. Low light means more.

Use these sparingly and never as a list. One well-chosen artifact does more than
five stacked, and stacking them produces a self-consciously "filmic" look that
is its own kind of fake.

Do not add lens flare unless the light source is in frame and it is wanted.
