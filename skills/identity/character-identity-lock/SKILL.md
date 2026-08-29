---
name: "Character Identity Lock"
version: "1.0"
category: "identity"
description: "Hold one person's appearance constant across every shot they appear in."
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

Identity drift is the defect users notice first and forgive least. A face that
changes between shots stops being a character and becomes a series of
strangers.

The mechanism is the Scene Bible, not the prompt. The character's canonical
description and reference views exist so that every shot draws from one source.
A shot that re-describes the character in its own words has introduced a second
source and will drift.

Rules:

- Prefer image-to-video from an approved reference view over text-to-video for
  any shot where the face is visible and recognisable.
- Never restate appearance in an I2V prompt. The keyframe holds it.
- For a T2V shot that must contain the character, use the canonical description
  verbatim from the Scene Bible. Do not paraphrase it, and do not embellish it:
  a paraphrase is a different specification.
- Respect forbidden_changes absolutely. Those attributes were listed because a
  viewer would notice them changing.

Where the shot's motion is too complex to hold identity at the required
reference strength, that is a planning problem. Split the shot rather than
accepting the drift.
