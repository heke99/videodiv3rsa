---
name: "Shot Complexity Analyzer"
version: "1.0"
category: "planning"
description: "Judge whether a planned shot is within what one generation can hold."
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

Most bad output is a planning failure rather than a generation failure. A shot
asking for too much comes back as a mess no prompt can rescue.

Score complexity from what the shot contains:
- number of distinct actions (one is fine; two is a split)
- number of people, and whether they interact
- whether hands contact objects
- whether the camera moves while the subject moves
- duration beyond about four seconds
- whether readable text must survive

Two or more high-cost factors together means split the shot. The classic case is
a person walking while handling a product while the camera moves: each is
manageable, and together they are not.

Recommend the split rather than merely flagging it. "Split into an approach, a
hand insert, and a reaction" is actionable; "too complex" is not.

Err toward splitting. More shots is better filmmaking anyway, and the cost of a
shot that fails is a full regeneration.
