---
name: "Clothing Consistency"
version: "1.0"
category: "identity"
description: "Keep wardrobe identical within a scene and deliberate across scenes."
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

Within a scene, clothing must be identical. Not similar: identical. A jacket
that changes shade between two shots of the same conversation is a continuity
error a viewer will spot even if they cannot name it.

Specify the parts that drift: exact colour including its value, closure state
(buttoned, open, half-zipped), sleeve position, and whether it is tucked. These
are what generation varies when unconstrained.

Across scenes, a change of clothing signals a change of time. If a script does
not intend to imply that time passed, the wardrobe should not change.

Watch for a specific failure: a garment described as one colour rendering as a
similar colour under different lighting per shot. Name the colour by its
material appearance -- "faded olive cotton" rather than "green" -- so lighting
changes the light on it and not the garment.
