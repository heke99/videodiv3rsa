---
name: "Prompt Normalizer"
version: "1.0"
category: "prompt"
description: "Strip a raw description down to what a generator can act on, before any model-specific compiler runs."
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

Take the shot's description and action and reduce them to concrete, visible
facts. Everything you keep must be something a camera could photograph.

Remove:
- Intent and evaluation. "A stunning, breathtaking shot that really sells the
  product" tells a video model nothing; it has no way to render *stunning*.
- Story context the frame cannot show. "She has been struggling with this for
  months" is backstory. What is visible is her expression and posture now.
- Redundant adjective stacks. "beautiful gorgeous elegant woman" is one weak
  signal repeated three times, and it crowds out the specific detail that would
  actually have helped.

Keep and sharpen:
- Subject, and what the subject is doing, as a single continuous action.
- Where they are, and what is behind them.
- Light: its direction, its hardness, its colour.
- What the camera is doing, if anything.

State one action per shot. If the description contains a sequence -- she picks
it up, examines it, then sets it down -- that is a planning error that should
have been split into separate shots, and compiling it into one prompt produces
a model best-guessing which part to render.

Output plain declarative sentences in present tense. No lists, no headings, no
parenthetical asides.
