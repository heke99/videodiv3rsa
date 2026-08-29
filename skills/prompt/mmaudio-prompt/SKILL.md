---
name: "MMAudio Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Describe the sound a shot should have, as sources rather than as a mood."
status: "active"
required_tools: []
supported_models: ["mmaudio"]
requires_skills: ["sfx-planner", "ambience-planner"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Video-to-audio models respond to named sound sources and ignore atmosphere
words. "Tense atmosphere" produces nothing usable; "a refrigerator hum, distant
traffic through a closed window, a chair creaking" produces a room.

Write the sources you can point at in the picture, loudest first. If a hand
touches a surface, that contact makes a sound and the model will place it
correctly when told it exists.

Separate the layers:

- **Contact sounds** tied to visible action -- footsteps, a jar opening, fabric.
- **Room tone** -- what this space sounds like empty. Every interior has one,
  and its absence is why generated video sounds like a vacuum.
- **Distance** -- what is audible from outside the frame.

Never ask for dialogue or music here. Dialogue comes from TTS on its own track,
and music is placed deliberately on the timeline. Sound generated over speech
cannot be separated afterwards.

State the duration in the request and let the timeline own it. This model fills
a window; it does not get to choose one.
