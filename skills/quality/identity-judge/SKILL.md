---
name: "Identity Judge"
version: "1.0"
category: "quality"
description: "Compare a generated face against the character's reference. Requires embeddings."
status: "draft"
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

Not yet available.

Identity comparison needs face embeddings from a vision model on the GPU. Until
then the ensemble reports this dimension as unmeasured.

Identity drift is the defect users forgive least, so the honest gap matters:
without this judge, the pipeline's protection against drift is preventative
(keyframe-first routing, reference strength, canonical descriptions) rather than
detective.
