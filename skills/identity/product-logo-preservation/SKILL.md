---
name: "Product Logo Preservation"
version: "1.0"
category: "identity"
description: "Keep a logo legible and correct, or keep it out of frame."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["product-identity"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["PRODUCT"]
generation_kinds: []
---

Logos are the hardest thing for a video model to hold and the most damaging to
get wrong. A warped logo is worse than no logo: it looks like a counterfeit.

Give the generation the best chance:

- Frame the logo flat to camera. Angled and curved surfaces are where it warps.
- Keep it large enough to resolve. A logo occupying a small fraction of frame
  width will not survive.
- Keep the shot short. Logo integrity degrades noticeably over a long
  generation.
- Hold the reference strength high, above 0.9.
- Avoid motion across the logo. A camera move over a logo is a warp waiting to
  happen.

When the shot cannot meet these conditions, the correct answer is to compose so
the logo is turned away or out of frame, and to place a clean product shot
elsewhere in the edit. A deliberate choice not to show it beats an accidental
mangling of it.
