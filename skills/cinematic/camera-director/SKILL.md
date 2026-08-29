---
name: "Camera Director"
version: "1.0"
category: "cinematic"
description: "Choose one camera behaviour per shot and justify it by what the shot is for."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["camera-language-translator"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["CINEMATIC", "REALISTIC", "ULTRA"]
generation_kinds: []
---

Every shot gets exactly one camera decision, and the default is that the camera
does not move. Movement has to earn itself.

It earns itself when it does something the cut cannot:

- **Reveal** -- the camera moves and new information enters the frame.
- **Follow** -- the subject moves and the frame keeps them in a stable
  relationship to it.
- **Pressure** -- a slow push tightens over a moment that is escalating.

If a proposed movement does none of these, hold the frame. Motion added for
energy reads as restlessness, and in generated video it costs temporal
stability for nothing: a moving camera is where warping backgrounds and
morphing geometry come from.

Match movement to shot length. A push that needs four seconds to land in a
two-second shot is a jerk, not a push. Under two seconds, hold.

Never stack. One movement per shot, always.
