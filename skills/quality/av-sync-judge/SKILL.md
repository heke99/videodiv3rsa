---
name: "AV Sync Judge"
version: "1.0"
category: "quality"
description: "Verify audio sits where the timeline says it should."
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

This judge checks the mechanical alignment of audio to picture, independently of
whether the mouth matches -- that is the lip sync judge's job.

Measure where speech actually begins in the rendered file and compare against
the timeline's declared start sample. Any difference is a rendering fault, not a
generation one, and it will affect every shot equally.

Thresholds follow perception, which is asymmetric: audio arriving before picture
is noticed at around 45 milliseconds, while audio arriving after is tolerated to
about 125. Treat early audio as the more serious failure.

Check the ends too. Speech that continues past its shot means the timeline's
extension logic did not run, and it will be audible as a line clipped by a cut.

Because everything here is measured against the timeline rather than judged, a
failure means something in composition is wrong and no amount of regeneration
will fix it.
