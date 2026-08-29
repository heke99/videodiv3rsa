---
name: "Caption Repair"
version: "1.0"
category: "repair"
description: "Rebuild captions from the alignment that will actually ship."
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

Captions are derived, never authored, so repairing them means rebuilding them
from the current dialogue alignment rather than editing the cues.

Rebuild whenever dialogue changed for any reason, including a regenerated line
with identical words: the timings differ even when the text does not.

Re-segment as part of the rebuild. New timings can produce lines that are too
fast or that break at the wrong place, so keeping the old segmentation with new
timings solves half the problem.

Re-check the safe area afterwards, since a longer line may now wrap onto an
extra row and push into the platform chrome.

Editing cue text by hand is always wrong. It desynchronises the captions from
the alignment, and the next rebuild silently discards the edit.
