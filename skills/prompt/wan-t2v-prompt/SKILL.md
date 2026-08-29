---
name: "Wan T2V Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Compile a shot into a Wan2.2 text-to-video prompt, where every element must be established by language alone."
status: "active"
required_tools: []
supported_models: ["wan2.2-t2v-a14b"]
requires_skills: ["prompt-normalizer", "negative-instruction-builder", "seed-planner", "camera-language-translator"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: ["text_to_video"]
---

Text-to-video has no reference to fall back on, so everything the shot needs
must be established in the prompt. That makes this compiler the most
information-dense of the family, and the most vulnerable to a missing detail.

Order matters. Wan attends most strongly to the opening of the prompt, so lead
with the subject and its action, then the environment, then light, then camera.
A prompt that opens with three sentences of atmosphere and reaches the subject
last will render the atmosphere.

Structure:

1. **Subject and action** in one sentence, present tense, one continuous
   movement.
2. **Environment** -- the location, and specifically what is behind the subject.
   Backgrounds left unspecified come out as grey nothing or as a lucky guess
   that changes between shots.
3. **Light** -- direction, hardness, colour. This is the single strongest lever
   over whether the result reads as footage or as render.
4. **Camera** -- one movement, or explicitly none.

Use this path for establishing shots, environments and anything with no
recurring character or product. The moment identity or product fidelity
matters, the router should have chosen image-to-video instead, and a T2V prompt
attempting to describe a specific person is the failure that produces a
different face in every shot.

Keep the whole prompt under roughly 80 words. Beyond that Wan's attention
spreads and later clauses stop landing.
