---
name: "Pause Planner"
version: "1.0"
category: "audio"
description: "Place silence where it carries meaning."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["dialogue-timing"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Silence is content. Generated speech has too little of it, which is part of why
it sounds relentless.

Place pauses:
- **Before** the point, to give it weight
- **After** a question, if one is asked
- **At a change of subject**, longer than a comma's worth
- **Where a person would breathe** -- roughly every fifteen to twenty words

Give them real durations. A meaningful pause is 300 to 600 milliseconds; a beat
before something important is 600 to 1000. Below about 200 milliseconds it
reads as a stumble rather than a choice.

Express pauses as explicit sample values on the dialogue line so the alignment
and the cut both honour them, instead of hoping the speech model produces them.

Do not pause on every comma. Over-pausing sounds like reading, which is the
thing being avoided.
