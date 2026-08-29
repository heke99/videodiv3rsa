---
name: "Flicker Judge"
version: "1.0"
category: "quality"
description: "Detect frame-to-frame instability in brightness or texture."
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

Flicker is temporal instability that no single frame reveals. A sequence can be
made of individually good frames and still be unwatchable.

Measure per-frame mean luma and its variance across the shot, and separately the
high-frequency energy per frame. Real footage varies smoothly; generated flicker
appears as a rapid oscillation with no motion to explain it.

Distinguish flicker from legitimate change. A shot where someone switches on a
lamp has a large luma step, and that is content, not a defect. What marks
flicker is oscillation: repeated changes with alternating sign at a rate faster
than anything in the scene moves.

Weight by area. Flicker in a large flat region -- a wall, a sky -- is far more
visible than the same magnitude across a busy texture.

This judge is deterministic and needs no model, which makes it one of the few
that can be trusted absolutely. Where it disagrees with a vision judge, prefer
this one.
