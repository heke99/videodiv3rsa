---
name: "Seed Planner"
version: "1.0"
category: "prompt"
description: "Assign seeds so retries explore and continuations stay consistent."
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

A seed is the difference between a retry that might work and a retry that
reproduces the same failure.

Rules:

- A regeneration after a quality failure gets a **new** seed. Re-rolling the
  same seed with the same prompt returns the same output, so retrying without
  changing the seed wastes the attempt entirely.
- A repair that keeps most of the shot -- lip sync, a local fix -- keeps the
  **same** seed. The point of a repair is that everything else stays as it was.
- Shots that must match each other, such as a reverse angle of the same moment,
  share a seed so their noise structure agrees.
- A user asking for "another take of the same idea" gets a new seed with an
  unchanged prompt. That is precisely what a seed is for.

Record the seed on the attempt. A shot the user liked and cannot reproduce is a
worse outcome than a shot that failed.
