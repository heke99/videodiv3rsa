---
name: "Informal Pacing"
version: "1.0"
category: "ugc"
description: "Vary rhythm so delivery sounds like thinking rather than reciting."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["UGC"]
generation_kinds: []
---

Even pacing is the tell of a read script. Real speech accelerates through the
familiar and slows at the point that matters.

Build the rhythm into the timing:

- **Fast through setup.** The context the speaker has said many times comes out
  quickly.
- **Slow at the turn.** The moment the claim lands gets space around it.
- **A real pause before the point**, not after it. Pausing after a claim is a
  presenter habit; pausing before it is how people actually build to something.
- **Trail off at the end** rather than landing hard. Hard endings sound
  scripted.

Express these as explicit pause values on the dialogue lines so the alignment
step honours them and the video is cut to them, rather than hoping the speech
model infers the intent.

Two pauses in a thirty-second script is plenty. More becomes halting.
