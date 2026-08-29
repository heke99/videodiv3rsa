---
name: "Timing Repair"
version: "1.0"
category: "repair"
description: "Fix placement faults by recomposing rather than regenerating."
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

Timing faults are the cheapest repairs available, and the most commonly
over-treated: they need no GPU at all.

Causes and fixes:
- Audio placed at the wrong sample: correct the timeline event and recompose.
- Speech overrunning its shot: extend the shot, which the assembler already does
  automatically; if it did not, the dialogue was not associated with the shot.
- A cut landing on a final consonant: extend by a few frames.
- Captions drifted: rebuild from alignment.

None of these touch a model. After the fix, recompose and re-run technical QC
and the AV sync judge, which is measured in seconds rather than minutes.

If a timing fault recurs after repair, the fault is in the assembly logic rather
than in this instance, and repeating the repair will not help. Escalate rather
than looping.
