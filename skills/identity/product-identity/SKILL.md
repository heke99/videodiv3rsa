---
name: "Product Identity"
version: "1.0"
category: "identity"
description: "Keep a product's shape, proportion and colour exactly as it is."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["PRODUCT"]
generation_kinds: []
---

A product is not a subject the model may interpret. It is a specific object that
exists, and a client will compare the output against it.

Hold four things:

- **Proportion.** Height against width against depth. Wide lenses change these,
  which is why product shots avoid them.
- **Silhouette.** Cap shape, shoulder curve, base. The outline is what a viewer
  recognises before any detail.
- **Colour.** By reference, not by name. "Green" covers thousands of products;
  the pack has one.
- **Material.** Glass, matte plastic and coated aluminium respond to light in
  ways that are unmistakable, and getting it wrong makes the product look cheap.

Always generate a keyframe from the approved product reference and drive the
video from it. Text-to-video for a real product is not a shortcut; it is a
guess, and it will not match.

Prefer shorter shots. Product fidelity degrades over a generation faster than
almost anything else.
