---
name: "UGC Authenticity Judge"
version: "1.0"
category: "ugc"
description: "Judge whether content reads as a real creator, without excusing actual defects."
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

This judge answers one question: would a viewer scrolling past believe a person
made this?

Score down for signs of production:
- lighting that is too even or too flattering to be a room
- framing that is too well composed
- speech that is too fluent and evenly paced
- a background that is too styled
- gestures that are too regular

Score down separately, and harder, for defects:
- identity drift, bad lip sync, wrong product, broken hands, impossible physics

Keep the two axes apart in the finding codes. A shot that is too polished needs
a different fix from a shot with a broken hand, and collapsing them into one
score means the repair planner cannot tell which it is.

Do not reward roughness on its own. A badly framed, badly lit shot with no
defects is not authentic, it is bad. The target is a competent person filming
casually, not an incompetent one.
