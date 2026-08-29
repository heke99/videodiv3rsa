---
name: "Wan I2V Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Compile a shot into a Wan2.2 image-to-video prompt, where the keyframe carries appearance and the prompt carries only motion."
status: "active"
required_tools: []
supported_models: ["wan2.2-i2v-a14b"]
requires_skills: ["prompt-normalizer", "negative-instruction-builder", "seed-planner", "motion-language-translator", "reference-strength-planner"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: ["image_to_video"]
---

The keyframe already establishes who, what and where. The prompt's job is
what happens next, and nothing else.

This is the discipline that makes image-to-video work, and the most common way
it is thrown away: re-describing the subject. If the keyframe shows a woman in
a green coat and the prompt also says "a woman in a green coat", the model now
has two sources for her appearance and will blend them. The coat shifts shade,
the face drifts, and the identity lock the keyframe was there to provide is
gone.

Write:

1. **The movement** -- what the subject does, starting from the pose in the
   frame. Continuity with the keyframe is what makes the first frames stable.
2. **What the camera does**, if anything.
3. **What changes in the scene**, if anything -- light shifting, a door
   opening behind.

Do not write: hair colour, clothing, facial features, the product's shape or
label, the room's contents. All of it is already in the frame.

Two further rules. Reference an object the keyframe does not contain and the
model must invent it mid-shot, which looks exactly as bad as it sounds. And
keep the motion within what one shot can hold: image-to-video degrades toward
the end of a long generation, and the keyframe's authority fades with it.
