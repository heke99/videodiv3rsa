---
name: "Continuity Planner"
version: "1.0"
category: "planning"
description: "Decide what must carry from shot to shot before anything is generated."
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

Continuity is cheaper to plan than to repair. Once shots exist, fixing a
mismatch means regenerating at least one of them.

Before generation, decide per scene:
- which entities appear, and from which canonical references
- where the light comes from, held across every shot
- which objects are present and where
- what each character is wearing and its state
- which shots hand a frame to the next one

Then write those decisions into the dependency graph so invalidation can use
them. A continuity requirement that exists only in a prompt is not enforceable
and will not be checked.

Watch specifically for time. Unless the script intends a jump, everything within
a scene is one continuous moment: the same light, the same clothes, the same
weather. Accidental time passage is the most common continuity failure in
generated video, because each shot is produced independently with nothing
holding them together but this plan.
