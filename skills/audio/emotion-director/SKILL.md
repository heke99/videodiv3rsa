---
name: "Emotion Director"
version: "1.0"
category: "audio"
description: "Give a line an emotional arc rather than a label."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["speech-director"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

A single emotion label applied to a whole line produces a performance held at
one level, which is what makes generated speech sound like a mask.

Give it a shape instead: where it starts, where it turns, where it ends.
"Sceptical at the start, softening on the second clause" is directable;
"positive" is not.

Keep it small. Real speech in this register moves through a narrow emotional
range, and generated speech asked for strong emotion overshoots badly. Understated
almost always outperforms.

Match the arc to the face if the shot is speech-driven, because the video model
receives the audio and will follow it. An arc in the voice with a fixed
expression is a mismatch a viewer notices.

For testimonials specifically, the arc that works is scepticism to quiet
surprise. Enthusiasm from the first word reads as paid.
