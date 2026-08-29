---
name: "Motion Language Translator"
version: "1.0"
category: "prompt"
description: "Describe how a subject moves in terms a generator can follow."
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

Motion prompts fail in a particular way: they describe the endpoint instead of
the movement, and the model renders a still of the endpoint.

Write the movement, not the outcome:

- Weak: "she has picked up the bottle"
- Strong: "she reaches for the bottle and lifts it toward her"

Anchor speed to something physical. "Slowly" is relative; "at a walking pace"
and "in a single unhurried motion" are not.

Give the body a direction of travel and a weight. A person crossing a room
shifts their weight; a person turning leads with their head and the shoulders
follow. Models reproduce these cues when they are present and produce the
gliding, weightless look when they are absent.

Keep it to one continuous movement per shot. Where a second movement is
genuinely needed, it belongs in the next shot.
