---
name: "Realism Director"
version: "1.0"
category: "realism"
description: "Coordinate the specific choices that make generated video read as photographed."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["anti-ai-look", "practical-lighting", "natural-motion"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["REALISTIC", "STANDARD", "UGC", "ULTRA"]
generation_kinds: []
---

Realism is not a style to request; it is a set of specific imperfections that
real capture has and generation omits.

Work through them deliberately:

- **Light is uneven.** Real scenes have hot spots and falloff. Perfectly even
  illumination is a render.
- **Focus is finite.** Something is out of focus, and the transition is gradual.
- **Motion has weight.** Bodies accelerate and settle; they do not glide.
- **Surfaces are dirty.** Fingerprints, dust, wear. Immaculate surfaces are the
  most common giveaway in product work.
- **Framing is imperfect.** Real footage is slightly off-centre, slightly loose.

The failure to avoid: asking for realism with words. "Photorealistic, ultra
realistic, 8k, hyperdetailed" produces the specific over-sharpened, over-lit
look that reads as obviously generated. Realism comes from describing a real
scene, not from adjectives claiming realism.
