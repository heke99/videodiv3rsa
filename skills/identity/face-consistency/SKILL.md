---
name: "Face Consistency"
version: "1.0"
category: "identity"
description: "Keep facial structure stable where it is most fragile."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["character-identity-lock"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Faces drift in a predictable order: first the softest features, then the
structure. Watching for them in that order catches drift while it is still
cheap to fix.

Most fragile, roughly in order:

1. Eyebrow shape and spacing
2. Nose width at the bridge
3. Jaw and chin definition
4. Eye spacing and shape
5. Lip fullness and mouth width

Structural features -- eye spacing, jaw, nose bridge -- matter more than
colouring. A viewer will accept a slight shift in hair tone and will not accept
a face whose proportions changed.

Practical measures: use a three-quarter reference rather than a full-frontal
one, because three-quarter carries more structural information. Keep faces
above roughly a fifth of frame height where identity must hold; below that
there is not enough resolution to preserve structure. And prefer shorter shots
for close-ups, since face drift accumulates over a generation.
