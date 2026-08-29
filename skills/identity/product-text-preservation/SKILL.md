---
name: "Product Text Preservation"
version: "1.0"
category: "identity"
description: "Keep on-pack text readable and correct, or keep it out of frame."
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

Text degrades before logos do. Small type on a pack will be garbled in most
generations, and garbled text on a product is an immediate credibility failure.

Decide per shot which text must be readable, and accept that everything else
will not be. Usually that is the brand name and one claim, at most.

For text that must read:

- Frame it flat and large.
- State the exact strings in the keyframe prompt so the image model has them.
- Hold reference strength at 0.9 or above.
- Keep the shot under about three seconds.
- Do not move the camera across it.

For everything else, compose so it is small, angled or out of focus. Text that
is clearly not meant to be read is not a defect; text that is nearly readable
and wrong is.

Verify with the text-preservation judge before accepting the shot. Do not rely
on it looking right at a glance -- it usually does.
