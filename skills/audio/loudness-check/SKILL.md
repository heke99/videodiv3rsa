---
name: "Loudness Check"
version: "1.0"
category: "audio"
description: "Verify the final mix meets its delivery target by measurement."
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

Loudness is not a matter of taste; each platform has a target and normalises
against it. Delivering louder than the target does not make the video louder,
it makes the platform turn it down, and the dynamics are lost for nothing.

Measure integrated loudness, true peak and range on the final render, and
compare against the profile: social and YouTube at -14 LUFS, broadcast at -23,
cinema at -27.

Tolerance is about 1 LU. Beyond that, re-normalise rather than adjusting by ear.

True peak matters separately. Above -1 dBTP, lossy encoding on the platform
will clip audibly even though the file itself does not.

A loudness range near zero means the mix is over-compressed and will sound
lifeless, which is a defect a single integrated number hides.
