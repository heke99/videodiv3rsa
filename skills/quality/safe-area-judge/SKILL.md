---
name: "Safe Area Judge"
version: "1.0"
category: "quality"
description: "Verify nothing important sits where platform chrome will cover it."
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

Platform interfaces cover parts of the frame, and content placed there is
invisible to most viewers even though it is present in the file.

Check burned-in captions, on-screen text and the subject's face against the
platform's safe area: roughly the lower 22% for TikTok, 20% for Reels, 18% for
Shorts, and less for web and broadcast.

The failure is silent. Nothing in the file is wrong, and a preview looks fine;
the caption is simply hidden behind the interface in the app.

Check the top too. Some surfaces place chrome there, and a subject framed high
to avoid the bottom can end up behind it.

Where a violation is found, the fix is layout rather than regeneration: move the
caption, or reframe on export. Regenerating a shot because of a caption position
is expensive and does not address the cause.
