---
name: "Prompt Repair"
version: "1.0"
category: "repair"
description: "Change the prompt in response to what failed, before spending another generation."
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

Regenerating with the same prompt and a new seed is a lottery. Regenerating with
a prompt corrected for the observed failure is a fix.

Map findings to prompt changes:
- **Static shot**: add explicit movement language and physical anchors; check
  the movement was not merely implied.
- **Hands**: reduce hand visibility, pre-establish the grip in a keyframe, add
  targeted negative terms.
- **Background instability**: name the background explicitly instead of leaving
  it unspecified.
- **Identity drift**: stop describing appearance in the prompt and let the
  keyframe carry it; raise reference strength.
- **Product text garbled**: shorten the shot, flatten the framing, or accept
  that the text will not read and reframe.
- **Too dark or too flat**: specify light direction and hardness rather than
  adding quality adjectives.

Change one thing per attempt. Changing three means learning nothing about which
mattered, and the benchmark data that would improve routing never accumulates.

Always change the seed alongside a prompt change, since the previous seed is
known to produce the failure.
