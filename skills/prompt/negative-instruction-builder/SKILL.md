---
name: "Negative Instruction Builder"
version: "1.0"
category: "prompt"
description: "Build a negative prompt from what this specific shot can plausibly get wrong, not from a boilerplate list."
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

A negative prompt is a budget. Every term you add dilutes the others, so a
hundred-word list of everything bad that has ever happened is weaker than six
terms aimed at this shot's actual failure modes.

Choose terms from what the shot contains:

- Hands visible and interacting with something: malformed hands, extra fingers,
  fused fingers.
- More than one person: merged bodies, duplicated faces, extra limbs.
- A face in close-up: distorted features, asymmetric eyes, waxy skin.
- Readable text or a logo on a product: garbled text, misspelled text, warped
  logo.
- Any camera movement: warping background, morphing geometry.
- A static or near-static subject: frozen frame, no motion.

Do not add terms for things the shot does not contain. "Extra fingers" on a
landscape establishing shot spends budget on an impossibility.

Never add quality words to the negative prompt as a reflex -- low quality,
blurry, jpeg artifacts. Modern video models do not respond to them the way
image models once did, and they occupy space that a real failure mode needed.
