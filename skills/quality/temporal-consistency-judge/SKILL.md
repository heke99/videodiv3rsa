---
name: "Temporal Consistency Judge"
version: "1.0"
category: "quality"
description: "Detect content that changes when it should not."
status: "active"
required_tools: ["ffmpeg"]
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Temporal consistency asks whether the same thing stays the same thing across
frames. It is the defect class that separates video generation from a sequence
of images.

Signals to combine:
- **Frame-to-frame structural similarity.** A sudden drop with no cut and no
  fast motion means content changed identity.
- **Background stability** in regions with no motion. A wall that reorganises
  itself is the clearest form of this.
- **Object persistence.** Something present in frame 10 and absent in frame 40
  with no exit path.

Normalise by motion. A fast pan legitimately produces low frame-to-frame
similarity, so compare against the motion magnitude rather than against a fixed
threshold. Failing to do that flags every moving shot.

Report the frames where it happened. A repair planner can act on "frames 60 to
72"; it cannot act on a score.
