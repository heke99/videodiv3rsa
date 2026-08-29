---
name: "Audio Ducking"
version: "1.0"
category: "audio"
description: "Keep speech intelligible without the music pumping."
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

Dialogue must always be the clearest element. Music under speech competes for
the same frequency range, and the fix is attenuation with the right shape.

Around 9 dB of attenuation is right for most material. Less and speech still
fights the bed; much more and the dip becomes an audible event of its own.

Start the duck slightly before the speech, roughly 120 milliseconds, so the
space is already open when the first word lands. Recover slowly, around 400
milliseconds, because a fast recovery is the pumping artifact.

Merge closely spaced lines into one duck. Music that lifts between every
sentence is far more distracting than music held down through a passage.

Duck music only. Ambience is already below speech and ducking it creates an
audible hole where the room disappears.
