---
name: "Facial Expression"
version: "1.0"
category: "motion"
description: "Give a face an expression that moves rather than a held pose."
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

A held expression is a mask, and generated video defaults to one because a
prompt naming an emotion gives no reason for it to change.

Describe expression as movement across the shot: where it starts, what changes
it, where it ends. "Neutral, softening as she recognises it" gives the model an
arc; "smiling" gives it a pose to hold for four seconds.

The specific parts that carry expression are the eyes and the mouth corners,
and they do not move together. A smile that reaches the eyes and one that does
not are entirely different signals, and generated faces default to the latter --
the mouth curves and the eyes stay flat, which reads as insincere.

Include blinks. Their absence is uncanny, and generated subjects frequently do
not blink at all.

Keep intensity low. Strong expressions overshoot badly and are rarely what the
material needs.
