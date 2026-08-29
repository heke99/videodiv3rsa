---
name: "Wan S2V Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Compile a talking shot for Wan2.2 S2V, where the audio drives the mouth and the prompt drives everything else."
status: "active"
required_tools: []
supported_models: ["wan2.2-s2v-14b"]
requires_skills: ["prompt-normalizer", "negative-instruction-builder", "seed-planner", "creator-eye-contact", "facial-expression"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: ["speech_to_video"]
---

The driving audio controls the mouth. Describing speech in the prompt does not
help and actively hurts: the model receives one instruction from the waveform
and a second from the text, and the mouth becomes less accurate, not more.

Never write: "she speaks", "he is talking", "mouth moving", "lip synced".

Write what the audio cannot carry:

1. **Everything below the neck and behind the subject.** Posture, whether they
   gesture, what is behind them. Speech-driven models animate the face well and
   leave the body inert unless told otherwise, and an inert body under an
   animated face is a large part of why avatar video reads as fake.
2. **Where they are looking.** Down the lens for direct address, slightly off
   for a more natural read. This single choice does more for whether a talking
   shot works than almost anything else.
3. **Expression across the line, not at a moment.** "Warm, becoming more
   certain as she goes" gives the model an arc; "smiling" gives it a mask held
   for the whole shot.
4. **Light and framing**, as normal.

Keep gestures sparse and specific. One hand movement described precisely beats
"gesturing naturally", which produces the continuous vague hand-waving that is
the tell of generated presenter footage.
