---
name: "TTS Prompt Compiler"
version: "1.0"
category: "prompt"
description: "Prepare a dialogue line for speech generation, including how it should be delivered."
status: "active"
required_tools: []
supported_models: ["qwen3-tts"]
requires_skills: ["speech-director", "pronunciation-planner"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

The text you send is spoken literally, so it must be the spoken form, not the
written one.

Convert before sending:

- Numerals to words, in the form a person would say them. "15%" is "fifteen
  percent"; "2019" is "twenty nineteen", not "two thousand and nineteen",
  unless the script's register calls for it.
- Symbols and abbreviations. "&" is "and". "Dr." is "doctor" or "drive"
  depending on context, and getting that wrong is audible.
- URLs and handles to how they are said aloud.

Mark delivery separately from text. Emotion, pace and emphasis belong in the
delivery fields; embedding stage directions in the text means hearing the model
read "(warmly)" out loud.

Punctuate for breath, not for grammar. A comma where a speaker would pause is
correct even where a copy editor would remove it. Sentences longer than about
twenty words will be delivered in one breath and sound like it.

Pass pronunciation hints for names, brands and anything ambiguous. A brand name
mispronounced consistently across a campaign is worse than one mispronounced
once, and it is the failure a client notices first.
