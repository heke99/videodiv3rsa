---
name: "Encoding Judge"
version: "1.0"
category: "quality"
description: "Verify the delivered file is technically correct for its destination."
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

The last thing that can go wrong is the file itself, and it goes wrong silently:
the video plays fine locally and fails on upload.

Check against the export profile:
- container and codec match what was requested
- pixel format is yuv420p, since 4:2:0 is what every platform accepts and 4:2:2
  or 4:4:4 output will be rejected or silently re-encoded
- resolution and frame rate match the timeline exactly
- the index is at the front, so playback can start before the download finishes
- audio stream present, at the expected sample rate and channel count
- bitrate within the platform's useful range: too low is visible, too high is
  discarded by the platform's own re-encode

None of this requires judgement. A failure is a definite defect, and it is
always cheaper to fix here than after an upload fails.
