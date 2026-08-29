---
name: "Walking Director"
version: "1.0"
category: "motion"
description: "Make walking read as walking rather than as sliding."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["human-motion-director"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Walking is the movement generated video fails at most visibly, because everyone
knows what it looks like.

The failures are specific: feet that do not contact the ground, a gait whose
cadence does not match the translation speed, and a body that stays perfectly
level.

Ask for the contact. "Her weight settles onto each step" gives the model
something the sliding failure cannot satisfy.

Ask for the vertical. Walking bounces slightly; a perfectly level head means the
body is being translated rather than walking.

Prefer lateral or diagonal movement across frame over walking directly toward
camera. Toward-camera walking requires consistent scale change and is where
proportion drift shows worst.

Keep walking shots short. Cadence errors accumulate, and a four-second walk is
far more likely to read correctly than a ten-second one.
