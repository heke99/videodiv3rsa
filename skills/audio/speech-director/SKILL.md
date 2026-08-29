---
name: "Speech Director"
version: "1.0"
category: "audio"
description: "Decide how a line should be delivered before it is generated."
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

Delivery is a decision, not a default. A line generated without one comes back
in the model's neutral register, which is the flat, slightly bright read that
marks synthetic speech.

For each line decide: energy relative to the surrounding lines, where the
emphasis falls, and whether it rises or settles at the end.

Emphasis is the most useful and most neglected. "I did not expect that to work"
means four different things depending on which word carries. State the word.

Match energy to content. Contradiction between what is said and how it is said
is audible and reads as insincere, which in a testimonial is fatal.

Let energy vary across a script. Uniform delivery is the strongest cue that
something was machine-read, and it is entirely avoidable.
