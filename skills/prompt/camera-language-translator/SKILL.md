---
name: "Camera Language Translator"
version: "1.0"
category: "prompt"
description: "Turn film-crew camera vocabulary into description a video model responds to."
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

Video models are trained on described footage, not on call sheets. They have
seen far more captions saying "the camera slowly moves closer" than captions
saying "slow push in on a 50mm".

Translate the intent, keep the result:

- Dolly in / push in -> the camera moves steadily closer to her
- Dolly out / pull back -> the camera draws back, revealing the room around him
- Truck / crab left -> the camera glides sideways past the shelves
- Pan -> the camera turns to follow her across the room
- Tilt up -> the camera tips upward from his hands to his face
- Crane up -> the camera rises above the crowd
- Handheld -> the frame drifts and settles slightly, as if hand-held
- Locked off -> the camera does not move
- Rack focus -> focus shifts from the bottle in front to her face behind

Two failure modes to avoid. Naming a lens length does nothing on its own:
describe the effect instead -- compressed background, or a wide field with
visible edge distortion. And stacking movements in one shot ("pan while
pushing in and craning up") produces incoherent motion; pick the one that
carries the shot.
