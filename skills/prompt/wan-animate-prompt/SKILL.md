---
name: "Wan Animate Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Compile a character-animation shot for Wan2.2 Animate, where a reference drives body motion."
status: "active"
required_tools: []
supported_models: ["wan2.2-animate-14b"]
requires_skills: ["prompt-normalizer", "negative-instruction-builder", "seed-planner", "human-motion-director"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: ["character_animation"]
---

Animate follows a reference for the character and produces deliberate body
movement. The prompt describes the movement's quality, not its geometry: the
reference already carries the body.

Write the *manner* of the motion:

- weight and effort -- does this cost her anything, or is it easy
- tempo -- and anchor it to something physical, not to an adverb
- what leads -- the hand, the shoulders, the eyes
- where it settles -- movement that stops cleanly reads as real; movement that
  drifts to a halt reads as generated

Do not restate the character's appearance. That is the reference's job, and
restating it produces the same blending failure as in image-to-video.

Do not stack actions. Animate holds one movement well and degrades sharply on
two, which is a planning problem rather than a prompting one: split the shot.
