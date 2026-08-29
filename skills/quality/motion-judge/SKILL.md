---
name: "Motion Judge"
version: "1.0"
category: "quality"
description: "Check that a shot moves as much as it was asked to, and no more."
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

Two opposite failures share this judge.

**Too little.** A shot planned with movement that comes back nearly static.
Measured as motion magnitude near zero with a high duplicate-frame ratio. This
is a real and common generation failure, and technically valid output makes it
easy to miss.

**Too much.** Motion far above what the action implies, usually meaning the
model is producing incoherent movement rather than the requested one. Often
accompanied by low temporal consistency.

Compare measured motion against the shot's planned `motion_complexity`. A shot
planned at 0.2 that measures 0.9 is as wrong as one planned at 0.8 that measures
0.05.

Also compare motion against interpolation, where used: interpolation that does
not increase apparent smoothness while increasing frame count has added cost for
nothing, and this judge is where that shows up.
