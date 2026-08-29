---
name: "Duration Planner"
version: "1.0"
category: "planning"
description: "Allocate the target duration across shots according to what each carries."
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
