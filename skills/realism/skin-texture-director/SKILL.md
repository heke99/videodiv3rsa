---
name: "Skin Texture Director"
version: "1.0"
category: "realism"
description: "Specify skin so it reads as skin rather than as plastic."
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

The waxy face is the most recognisable failure in generated humans, and it comes
from an absence of texture rather than from smoothing.

Ask for what skin actually has, sized to the shot:

- **Close-up**: visible pores, fine lines around eyes and mouth, slight
  unevenness in tone, a little shine where the skin is oiliest -- forehead,
  nose bridge -- and matte elsewhere.
- **Medium**: uneven tone, natural shine, no pore detail.
- **Wide**: nothing. Asking for pore detail at distance wastes prompt budget on
  something the frame cannot resolve.

Never ask for flawless, poreless, or perfect skin. Beyond looking synthetic, in
a product context it also misrepresents what the product does.

Mention where skin is thinner and redder -- around the nose, the ears, the
knuckles. Uniform colour across a face is a strong tell.
