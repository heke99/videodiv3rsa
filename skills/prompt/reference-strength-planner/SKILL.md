---
name: "Reference Strength Planner"
version: "1.0"
category: "prompt"
description: "Decide how hard a reference image should constrain the generation."
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

Reference strength trades identity against motion. Held too tight, the subject
is unmistakably right and barely moves; too loose, the shot moves well and the
face drifts.

Start from what the shot is for:

- **Identity-critical, little movement** (a talking head, a product hero):
  0.85 to 0.95. The reference is the point.
- **Identity-critical with real movement** (a character walking through a
  scene): 0.6 to 0.75. Above this the model fights its own motion prior and
  produces the stiff, sliding look that reads instantly as generated.
- **Composition guidance only** (matching a framing or a palette): 0.3 to 0.45.
- **Product with readable text or a logo**: 0.9 or above, and prefer a shorter
  shot. Pack text degrades faster than faces do, and no repair recovers it.

When identity and motion genuinely conflict, split the shot rather than
compromising: a held frame for the identity beat, a looser shot for the
movement. That is almost always better than one shot that does neither well.
