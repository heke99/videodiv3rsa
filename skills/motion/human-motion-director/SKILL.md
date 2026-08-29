---
name: "Human Motion Director"
version: "1.0"
category: "motion"
description: "Coordinate how a person moves so the whole body participates."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["natural-motion"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Generated humans move from the limbs outward: the arm reaches and nothing else
changes. Real bodies move from the centre.

For any human movement, describe what the core does. Reaching involves the
shoulders and a shift of weight. Turning starts at the head, then the shoulders,
then the hips. Standing from a chair is led by the torso coming forward.

Keep one movement per shot, with a clear beginning and a clear settle. Movements
that neither start nor end within the shot read as fragments.

Give the movement a reason. A person who moves because the script needs
movement moves like a puppet; a person who moves to reach something, to see
something, or to get out of the way moves like a person.

Where two people interact, describe the interaction from one side only. Two
independently described bodies produce the merged-limb failures that anatomy
judges catch.
