---
name: "Composition Director"
version: "1.0"
category: "cinematic"
description: "Arrange the frame so the eye lands where the shot intends."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["CINEMATIC", "ULTRA"]
generation_kinds: []
---

Composition is control over where a viewer looks first. Decide that, then build
the frame around it.

What draws the eye, roughly in order: faces, movement, contrast, convergence,
saturation. A frame with a bright window behind a face has told the viewer to
look at the window.

Practical consequences:

- Put the subject where a line in the scene points to them -- a counter edge, a
  road, a shadow.
- Keep the brightest area of the frame on or near the subject, unless the
  intent is silhouette.
- Give the background depth: something near, something far. Flat backgrounds
  are where generated video looks like a photograph of a wall.
- Keep the frame simple. Every additional element is another thing the model
  can render badly, and another thing competing for attention.
