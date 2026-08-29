import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def ev(cases): return "# Eval\n\n```json\n" + cases + "\n```\n"

CINEMATIC = {
"camera-director": dict(
    name="Camera Director", status="active", modes=["CINEMATIC", "REALISTIC", "ULTRA"],
    description="Choose one camera behaviour per shot and justify it by what the shot is for.",
    requires_skills=["camera-language-translator"],
    body="""
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
""",
    eval=ev("""[
  {"id": "defaults-to-static",
   "input": {"shot": {"action": "she reads a label", "duration_frames": 48}},
   "expect": {"movement": "static"}},
  {"id": "moves-to-reveal",
   "input": {"shot": {"action": "the camera reveals the crowd behind her", "duration_frames": 96}},
   "expect": {"movement_not": "static"}},
  {"id": "refuses-movement-in-a-short-shot",
   "input": {"shot": {"action": "slow push in", "duration_frames": 30}},
   "expect": {"movement": "static"}}
]""")),

"lens-director": dict(
    name="Lens Director", status="active", modes=["CINEMATIC", "REALISTIC", "ULTRA"],
    description="Express lens choice as its visible effect rather than as a focal length.",
    body="""
A focal length in a prompt does very little. Its visible consequences do a lot,
so describe those.

- **Wide**: the background stretches away, edges distort, the subject dominates
  and the space around them feels large. Right for establishing and for
  handheld intimacy at close range.
- **Normal**: proportions read as they do to the eye. The safe default, and
  correct far more often than it is used.
- **Long**: the background compresses and flattens toward the subject, and
  falls out of focus readily. Right for isolating a subject from a busy scene
  and for the compressed look of observed footage.

Match the lens to the distance the framing implies. A close-up described with
wide-lens distortion is a specific, unflattering look; if that is not the
intent, it is an error.

For product work, avoid wide. Distortion changes the object's proportions, and
proportion is part of what the product judge is checking.
""",
    eval=ev("""[
  {"id": "describes-effect-not-numbers",
   "input": {"shot": {"shot_type": "closeup"}},
   "expect": {"not_contains": ["mm", "35mm", "85mm"]}},
  {"id": "avoids-wide-on-product",
   "input": {"shot": {"shot_type": "product_hero", "requires_product_fidelity": true}},
   "expect": {"lens_not": "wide"}}
]""")),

"framing-director": dict(
    name="Framing Director", status="active",
    description="Place the subject in frame for the platform and the moment.",
    body="""
Framing is decided by two things: what the shot needs to show, and where the
platform will cover the frame.

Shot size follows information. A viewer who needs to read an expression needs a
close-up; one who needs to understand a space needs a wide. Choosing a medium
by default gives neither.

Then account for the platform. Vertical social formats put chrome over the
bottom fifth and sometimes the top: a subject centred vertically in a 9:16
frame ends up behind a caption bar. Bias the subject upward, and keep anything
that must be read out of the lower fifth entirely.

Leave the right space. A subject looking or moving frame-left needs space on
the left to look into; the same subject pressed against the left edge reads as
cramped and wrong even to a viewer who could not say why.

Headroom: a little, not a lot. Generated video is prone to too much, which
reads as a security camera.
""",
    eval=ev("""[
  {"id": "biases-upward-in-vertical",
   "input": {"shot": {"shot_type": "medium"}, "aspect_ratio": "9:16"},
   "expect": {"subject_above_centre": true}},
  {"id": "keeps-readable-content-out-of-the-lower-fifth",
   "input": {"shot": {"shot_type": "product_hero"}, "aspect_ratio": "9:16"},
   "expect": {"avoids_lower_fifth": true}},
  {"id": "close-up-when-expression-carries-the-shot",
   "input": {"shot": {"action": "she realises it worked"}},
   "expect": {"shot_type_in": ["closeup", "medium"]}}
]""")),

"composition-director": dict(
    name="Composition Director", status="active", modes=["CINEMATIC", "ULTRA"],
    description="Arrange the frame so the eye lands where the shot intends.",
    body="""
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
""",
    eval=ev("""[
  {"id": "keeps-brightest-area-on-subject",
   "input": {"shot": {"description": "she stands in front of a bright window"}},
   "expect": {"flags_backlight_conflict": true}},
  {"id": "asks-for-depth",
   "input": {"shot": {"description": "a person against a wall"}},
   "expect": {"has_depth_clause": true}}
]""")),

"lighting-director": dict(
    name="Lighting Director", status="active", modes=["CINEMATIC", "REALISTIC", "PRODUCT", "ULTRA"],
    description="Specify light by direction, hardness and colour, because it decides whether the result reads as footage.",
    requires_skills=["practical-lighting"],
    body="""
Light is the strongest single lever over whether generated video reads as
photographed. Specify three properties every time.

**Direction.** Where it comes from, and therefore where the shadows fall. Front
light flattens and is the default a model reaches for when unspecified, which
is part of the generated look. Side light gives form. Three-quarter back gives
separation and is what most flattering footage actually uses.

**Hardness.** A small source gives hard edges and deep shadows; a large one
gives soft gradients. Say which. "Soft light from a large window" and "hard
midday sun" are different worlds.

**Colour.** Warm, neutral or cool, and whether sources disagree. Mixed
temperature -- warm lamp inside, blue daylight through the window -- is one of
the most reliable cues of real footage, because it almost never happens in a
render unless asked for.

Then state what it does to the subject: a rim on the shoulder, a shadow across
half the face, catchlights in the eyes. Catchlights in particular are the
difference between eyes that look alive and eyes that look printed.
""",
    eval=ev("""[
  {"id": "always-states-direction",
   "input": {"shot": {"description": "a woman at a desk"}},
   "expect": {"has_direction_clause": true}},
  {"id": "always-states-hardness",
   "input": {"shot": {"description": "a woman at a desk"}},
   "expect": {"has_hardness_clause": true}},
  {"id": "avoids-flat-front-light-by-default",
   "input": {"shot": {"description": "a portrait"}},
   "expect": {"direction_not": "flat front"}}
]""")),

"color-director": dict(
    name="Colour Director", status="active", modes=["CINEMATIC", "ULTRA"],
    description="Keep colour consistent across shots and appropriate to the material.",
    body="""
Colour is a continuity problem before it is an aesthetic one. A palette that
shifts between shots is the fastest way for a sequence to stop reading as one
piece, and it is what a colour continuity judge will flag.

Fix three things at the project level and hold them across every shot: overall
temperature, contrast, and how saturated skin is allowed to be.

Then per shot, only describe deviations that the scene motivates -- a warmer
interior, a cooler exterior at dusk.

Restraint matters more than grade names. Heavy teal-and-orange, crushed blacks
and lifted shadows all read as a filter, and a filter reads as generated.
Footage that looks real is usually closer to neutral than people expect.

Never let a colour choice compromise a product's own colours. If the grade
would shift a brand colour, the grade is wrong.
""",
    eval=ev("""[
  {"id": "holds-palette-across-shots",
   "input": {"shots": [{"id": "s1"}, {"id": "s2"}]},
   "expect": {"consistent_palette": true}},
  {"id": "protects-brand-colour",
   "input": {"shot": {"requires_product_fidelity": true}, "product": {"colors": ["#1B7F4B"]}},
   "expect": {"preserves_product_colour": true}}
]""")),

"movement-director": dict(
    name="Movement Director", status="active", modes=["CINEMATIC", "ULTRA"],
    description="Decide how camera movement starts, sustains and stops.",
    requires_skills=["camera-director"],
    body="""
Given that a shot moves, the quality of the movement is in its ends.

Real camera moves ease in and ease out. They do not begin at full speed or stop
dead. A move that starts instantly is the single clearest sign of a synthetic
camera.

Sustain has to be slower than feels right when writing it. Camera moves that
read as elegant on screen are slower than the words describing them suggest,
and generated video amplifies speed: a move described as "steady" often comes
back as a lurch.

Stop the move before the shot ends. A move still travelling at the cut is
disorienting, and it removes the editor's freedom to hold the last frame.

For handheld, the movement is not the point -- the microcorrections are. Drift
and settle, not sway.
""",
    eval=ev("""[
  {"id": "eases-both-ends",
   "input": {"shot": {"camera": {"movement": "push in"}, "duration_frames": 96}},
   "expect": {"has_ease_in": true, "has_ease_out": true}},
  {"id": "settles-before-the-cut",
   "input": {"shot": {"camera": {"movement": "pan"}, "duration_frames": 96}},
   "expect": {"settles_before_end": true}}
]""")),

"blocking-director": dict(
    name="Blocking Director", status="active", modes=["CINEMATIC", "ULTRA"],
    description="Place people in the space and keep their relationships legible across a scene.",
    body="""
Blocking is where people are relative to each other and to the camera, and it
has to survive the cut.

Keep the line. Once two people face each other, the camera stays on one side of
the axis between them; crossing it flips their screen positions and the scene
becomes confusing without the viewer knowing why. This matters more in
generated video than in filmed, because each shot is produced independently and
nothing enforces continuity but the plan.

Give each person a reason to be where they are. People stand at counters, lean
on things, sit at the near end of a table. Figures standing in open space with
nothing to relate to is a generated-video signature.

Movement through the frame is more legible than movement toward the camera.
Depth changes are where scale drift shows up.

With more than two people, keep one clearly dominant in frame. Crowds of
equally weighted figures are where anatomy fails.
""",
    eval=ev("""[
  {"id": "holds-the-axis",
   "input": {"scene": {"shots": [{"id": "s1", "camera_side": "left"}, {"id": "s2", "camera_side": "right"}]}},
   "expect": {"flags_axis_crossing": true}},
  {"id": "limits-equal-weight-figures",
   "input": {"shot": {"character_ids": ["c1", "c2", "c3", "c4"]}},
   "expect": {"has_dominant_subject": true}}
]""")),
}

REALISM = {
"realism-director": dict(
    name="Realism Director", status="active", modes=["REALISTIC", "STANDARD", "UGC", "ULTRA"],
    description="Coordinate the specific choices that make generated video read as photographed.",
    requires_skills=["anti-ai-look", "practical-lighting", "natural-motion"],
    body="""
Realism is not a style to request; it is a set of specific imperfections that
real capture has and generation omits.

Work through them deliberately:

- **Light is uneven.** Real scenes have hot spots and falloff. Perfectly even
  illumination is a render.
- **Focus is finite.** Something is out of focus, and the transition is gradual.
- **Motion has weight.** Bodies accelerate and settle; they do not glide.
- **Surfaces are dirty.** Fingerprints, dust, wear. Immaculate surfaces are the
  most common giveaway in product work.
- **Framing is imperfect.** Real footage is slightly off-centre, slightly loose.

The failure to avoid: asking for realism with words. "Photorealistic, ultra
realistic, 8k, hyperdetailed" produces the specific over-sharpened, over-lit
look that reads as obviously generated. Realism comes from describing a real
scene, not from adjectives claiming realism.
""",
    eval=ev("""[
  {"id": "never-uses-realism-adjectives",
   "input": {"shot": {"description": "a kitchen scene"}},
   "expect": {"not_contains": ["photorealistic", "ultra realistic", "8k", "hyperdetailed", "masterpiece"]}},
  {"id": "adds-a-specific-imperfection",
   "input": {"shot": {"description": "a bottle on a counter"}},
   "expect": {"has_imperfection_clause": true}}
]""")),

"anti-ai-look": dict(
    name="Anti AI Look", status="active", modes=["REALISTIC", "UGC", "ULTRA"],
    description="Remove the specific tells that mark a shot as generated.",
    body="""
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
""",
    eval=ev("""[
  {"id": "asks-for-asymmetry",
   "input": {"shot": {"shot_type": "closeup"}},
   "expect": {"has_asymmetry_clause": true}},
  {"id": "asks-for-skin-texture-on-a-closeup",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"has_skin_texture_clause": true}},
  {"id": "never-names-the-artifact",
   "input": {"shot": {"description": "a portrait"}},
   "expect": {"not_contains": ["AI look", "not AI", "artificial looking"]}}
]""")),

"practical-lighting": dict(
    name="Practical Lighting", status="active", modes=["REALISTIC", "UGC", "CINEMATIC", "ULTRA"],
    description="Motivate every light by something that exists in the scene.",
    body="""
Light that comes from a visible source reads as real. Light that comes from
nowhere reads as a render, even when a viewer cannot articulate why.

For each shot, name where the light is coming from in the world: a window, a
lamp, an overhead fixture, a phone screen, the open sky. Then describe the
quality that source would produce -- a window is large and soft, a bare bulb is
small and hard, an overcast sky is enormous and directionless.

Let sources disagree. Interiors in daylight almost always mix warm artificial
light with cool daylight, and that mix is one of the strongest realism cues
available.

Let it fall off. Light from a window is bright at the window and dim across the
room. Even illumination across a whole space means no source, and no source
means no realism.

For UGC specifically, the practical is usually a window, a ring light, or an
overhead fixture, and each has a recognisable signature. A ring light's circular
catchlight is a genuine artifact of how creators shoot, not a defect.
""",
    eval=ev("""[
  {"id": "names-a-visible-source",
   "input": {"shot": {"description": "an interior at midday"}},
   "expect": {"has_named_source": true}},
  {"id": "includes-falloff",
   "input": {"shot": {"description": "a large room lit by one window"}},
   "expect": {"has_falloff_clause": true}}
]""")),

"natural-motion": dict(
    name="Natural Motion", status="active", modes=["REALISTIC", "UGC", "ULTRA"],
    description="Give movement the weight and imperfection real bodies have.",
    requires_skills=["motion-language-translator"],
    body="""
The generated-motion tell is weightlessness: subjects translate through space at
constant speed without their mass participating.

Counter it with physical specifics:

- **Acceleration and deceleration.** Bodies start slowly and stop gradually.
- **Counterbalance.** A reaching arm shifts the shoulders; a step shifts the
  hips. Bodies move as systems.
- **Follow-through.** Hair, loose clothing and held objects continue after the
  body stops. Their absence is why generated motion looks like a puppet.
- **Micro-motion in stillness.** A person standing still is not a statue: they
  breathe, shift weight, blink. Truly static humans read as frozen frames, and
  the duplicate-frame judge will flag it.

Ask for one of these per shot, chosen for what the movement is. All four at
once produces a description the model cannot prioritise.
""",
    eval=ev("""[
  {"id": "adds-follow-through-for-a-stopping-motion",
   "input": {"shot": {"action": "she stops walking and turns"}},
   "expect": {"has_follow_through_clause": true}},
  {"id": "adds-micro-motion-for-a-still-subject",
   "input": {"shot": {"action": "he stands looking at the camera"}},
   "expect": {"has_micro_motion_clause": true}}
]""")),

"skin-texture-director": dict(
    name="Skin Texture Director", status="active", modes=["REALISTIC", "UGC", "ULTRA"],
    description="Specify skin so it reads as skin rather than as plastic.",
    body="""
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
""",
    eval=ev("""[
  {"id": "detail-scales-with-shot-size",
   "input": {"shot": {"shot_type": "wide", "character_ids": ["c1"]}},
   "expect": {"not_contains": ["pores"]}},
  {"id": "closeup-gets-pore-detail",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"contains_any": ["pores", "fine lines"]}},
  {"id": "never-asks-for-flawless",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"not_contains": ["flawless", "poreless", "perfect skin"]}}
]""")),

"physical-camera-behavior": dict(
    name="Physical Camera Behaviour", status="active", modes=["REALISTIC", "CINEMATIC", "ULTRA"],
    description="Include the artifacts a real lens and sensor produce.",
    body="""
Real cameras are imperfect instruments, and their imperfections are load-bearing
signals of authenticity.

Where the shot warrants it, include:

- **Motion blur** consistent with the movement and shutter. Perfectly crisp
  fast motion is a giveaway; every frame sharp during a quick pan is impossible.
- **Focus breathing** -- the frame shifts very slightly during a focus change.
- **Falloff toward the corners**, both in brightness and sharpness.
- **Highlight rolloff** -- real sensors clip gradually, not abruptly.
- **Fine grain**, matched to the implied light level. Low light means more.

Use these sparingly and never as a list. One well-chosen artifact does more than
five stacked, and stacking them produces a self-consciously "filmic" look that
is its own kind of fake.

Do not add lens flare unless the light source is in frame and it is wanted.
""",
    eval=ev("""[
  {"id": "adds-motion-blur-to-fast-motion",
   "input": {"shot": {"action": "she turns quickly", "motion_complexity": 0.8}},
   "expect": {"has_motion_blur_clause": true}},
  {"id": "keeps-artifacts-sparse",
   "input": {"shot": {"description": "a static portrait"}},
   "expect": {"max_artifacts": 2}}
]""")),
}

write_all("cinematic", CINEMATIC)
write_all("realism", REALISM)
