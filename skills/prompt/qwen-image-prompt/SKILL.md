---
name: "Qwen Image Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Compile a keyframe or reference still, where every detail must survive into the video that follows."
status: "active"
required_tools: []
supported_models: ["qwen-image-2"]
requires_skills: ["prompt-normalizer", "negative-instruction-builder", "seed-planner", "framing-director", "lighting-director"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: ["image"]
---

A keyframe is not a picture; it is the specification the video model will spend
the whole shot trying to hold. Anything vague here becomes drift there.

Be specific in the places video models lose first:

- **Face**: structure, not adjectives. "Wide-set eyes, a slightly crooked nose,
  a small scar through the left eyebrow" survives a generation. "Beautiful"
  does not.
- **Hands**: if they will be visible in the shot, put them in a clear,
  unambiguous position in the frame. Hands entering a shot from an unclear
  starting pose are where hand artifacts come from.
- **Product text and logo**: state them exactly, and frame the product so they
  are legible and unforeshortened. Text that is small or angled in the keyframe
  is text that will be garbled in the video.
- **Light**: direction, hardness, colour temperature, and where the shadows
  fall. The video model will hold whatever lighting the keyframe establishes.

Compose for what comes next. Leave the room in frame that the movement needs;
a keyframe cropped tight around a subject who is about to walk forward forces
the video model to invent the space she walks into.

For an edit rather than a generation, describe only the change. Restating the
parts that should stay is how they change.
