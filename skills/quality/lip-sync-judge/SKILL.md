---
name: "Lip Sync Judge"
version: "1.0"
category: "quality"
description: "Score mouth movement against the driving audio. Requires a vision model."
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

Distinct from the AV sync judge, which measures whether audio sits at the right
sample and is implemented. This one measures whether the mouth matches the
phonemes, which needs vision on the GPU.

Until it exists, the MuseTalk repair path cannot be triggered automatically,
because nothing can detect the failure it repairs.
