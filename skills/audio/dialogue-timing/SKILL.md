---
name: "Dialogue Timing"
version: "1.0"
category: "audio"
description: "Fit speech to picture without speeding either up."
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

Speech and picture are produced separately and must be reconciled. There is a
right order to try the fixes.

1. **Extend the shot.** Frames are cheap and the audio is already correct.
2. **Cut words.** Almost every script is longer than it needs to be, and cutting
   improves it independently.
3. **Adjust the pause structure.** Tightening pauses recovers real time without
   touching delivery.
4. **Change the speech rate**, slightly, and only as a last resort.

Never do the fourth first. Speeding up speech to fit a planned duration is
instantly audible and is the most common way generated dialogue betrays itself.

Extending is nearly always right, because the plan's duration was a guess and
the audio is a measurement. The timeline already implements this: a shot whose
dialogue overruns is extended rather than clipped.

Leave a beat at the end of a line before the cut. Cutting on the final
consonant feels rushed even when it is technically correct.
