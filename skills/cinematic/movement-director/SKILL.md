---
name: "Movement Director"
version: "1.0"
category: "cinematic"
description: "Decide how camera movement starts, sustains and stops."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["camera-director"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["CINEMATIC", "ULTRA"]
generation_kinds: []
---

Given that a shot moves, the quality of the movement is in its ends.

Real camera moves ease in and ease out. They do not begin at full speed or stop
dead. A move that starts instantly is the single clearest sign of a synthetic
camera.

Sustain has to be slower than feels right when writing it. Camera moves that
read as elegant on screen are slower than the words describing them suggest,
and generated video amplifies speed: a move described as "steady" often comes
back as a lurch.

Stop the move before the shot ends. A move still travelling at the cut is
disorienting, and it removes the editor's freedom to hold the last frame.

For handheld, the movement is not the point -- the microcorrections are. Drift
and settle, not sway.
