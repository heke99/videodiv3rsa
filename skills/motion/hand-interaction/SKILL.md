---
name: "Hand Interaction"
version: "1.0"
category: "motion"
description: "Handle the hardest thing generated video does: hands touching objects."
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

Hands are the most common visible defect, and hands holding something are worse
than hands alone, because the contact has to be geometrically right.

Reduce the difficulty rather than trying to prompt through it:

- **Establish the grip before the shot starts.** A keyframe where the hand
  already holds the object is far more reliable than a generation that must
  form the grip mid-shot.
- **Keep the hand partly out of frame or partly occluded** where the shot
  allows. A hand entering from the edge with two fingers visible is much safer
  than a full open palm.
- **Avoid finger-counting shots.** Open palms facing camera are where extra
  fingers appear.
- **Keep the object large enough** that the grip is unambiguous. Small objects
  produce vague, melting contact.
- **Keep it short.** Hand integrity degrades quickly.

Where the shot needs a clean hand-on-product moment and cannot get it, an insert
shot generated from a still is usually better than a failing action shot.
