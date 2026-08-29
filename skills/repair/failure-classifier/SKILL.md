---
name: "Failure Classifier"
version: "1.0"
category: "repair"
description: "Turn a set of findings into one diagnosis with a cause."
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

Findings are symptoms. Repair needs a cause, because the cheapest fix depends on
what actually went wrong rather than on what was noticed.

Group findings into a single classification:

- **Composition fault** -- AV sync off, captions stale, safe area violated,
  encoding wrong. Nothing was generated badly; the assembly is wrong. Never
  regenerate for these.
- **Local artifact** -- a defect confined to a region or a frame range, with the
  rest of the shot sound.
- **Motion fault** -- the shot is static when it should move, or incoherent.
- **Audio fault** -- clipping, silence, loudness.
- **Identity or product fault** -- the wrong person or the wrong object. Check
  whether the canonical entity changed: if it did, this is invalidation rather
  than a generation failure, and other shots are affected too.
- **Whole-shot failure** -- multiple unrelated high-severity findings. Only this
  class justifies regenerating.

When findings point at several classes, take the cheapest one that explains most
of them. Regeneration is the diagnosis of last resort, not the default.
