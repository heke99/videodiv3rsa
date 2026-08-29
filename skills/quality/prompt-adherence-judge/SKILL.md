---
name: "Prompt Adherence Judge"
version: "1.0"
category: "quality"
description: "Judge whether the shot shows what was asked for. Requires a vision model."
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

Judging whether generated footage matches its prompt requires a vision model,
which requires the GPU this deployment does not yet have. The judge is
registered so the ensemble knows it exists and reports it as unavailable, rather
than silently scoring the dimension as passing.

Deliberately not substituted with a proxy. A confident number from a weaker
signal would be worse than an honest absence, because the repair planner would
act on it.
