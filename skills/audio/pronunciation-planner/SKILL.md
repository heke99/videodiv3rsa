---
name: "Pronunciation Planner"
version: "1.0"
category: "audio"
description: "Make sure names and brands are said correctly and identically every time."
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

A brand name mispronounced is the error a client notices before any other, and
one mispronounced differently between shots is worse still.

Collect, before any speech is generated:
- the brand name and every product name
- personal and place names
- initialisms, and whether each is spelled out or said as a word
- loanwords and anything whose spelling does not predict its sound
- ambiguous English words where the sense decides the sound -- read, live, lead

Give each a respelling the speech model can act on, and store it on the voice
profile so every line in the project inherits it. A hint applied per line will
eventually be forgotten on one, and that one will ship.

Check numbers too. Years, prices and percentages have several valid readings,
and consistency matters more than which one is chosen.

Where a pronunciation is genuinely uncertain, ask rather than guessing. It is a
question a person can answer in seconds and a model cannot answer at all.
