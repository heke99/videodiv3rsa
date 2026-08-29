---
name: "Anti AI Look"
version: "1.0"
category: "realism"
description: "Remove the specific tells that mark a shot as generated."
status: "active"
required_tools: []
supported_models: []
requires_skills: []
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: ["REALISTIC", "UGC", "ULTRA"]
generation_kinds: []
---

The generated look is a short list of recurring, identifiable properties. Name
them and counter them individually.

- **Too symmetrical.** Faces are asymmetric; so is everything else. Ask for it.
- **Too clean.** No dust, no wear, no fingerprints. Real surfaces have all three.
- **Too evenly lit.** See the lighting director; this is the biggest one.
- **Too saturated,** particularly in skin and greenery.
- **Too sharp everywhere.** Real optics are sharpest in the middle and fall off.
- **Too centred.** Perfect composition reads as constructed.
- **Skin without texture.** Pores, fine lines, slight unevenness. The waxy look
  is the absence of these, not the presence of blur.
- **Eyes too matched.** Real eyes catch light slightly differently.

Counter them by describing the real property, never by naming the artifact.
"Not AI-looking" in a prompt does nothing; "fine lines at the corners of her
eyes, slightly uneven skin tone across her cheek" does.
