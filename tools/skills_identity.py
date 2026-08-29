import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def ev(cases): return "# Eval\n\n```json\n" + cases + "\n```\n"

IDENTITY = {
"character-identity-lock": dict(
    name="Character Identity Lock", status="active",
    description="Hold one person's appearance constant across every shot they appear in.",
    body="""
Identity drift is the defect users notice first and forgive least. A face that
changes between shots stops being a character and becomes a series of
strangers.

The mechanism is the Scene Bible, not the prompt. The character's canonical
description and reference views exist so that every shot draws from one source.
A shot that re-describes the character in its own words has introduced a second
source and will drift.

Rules:

- Prefer image-to-video from an approved reference view over text-to-video for
  any shot where the face is visible and recognisable.
- Never restate appearance in an I2V prompt. The keyframe holds it.
- For a T2V shot that must contain the character, use the canonical description
  verbatim from the Scene Bible. Do not paraphrase it, and do not embellish it:
  a paraphrase is a different specification.
- Respect forbidden_changes absolutely. Those attributes were listed because a
  viewer would notice them changing.

Where the shot's motion is too complex to hold identity at the required
reference strength, that is a planning problem. Split the shot rather than
accepting the drift.
""",
    eval=ev("""[
  {"id": "prefers-i2v-when-face-is-visible",
   "input": {"shot": {"character_ids": ["c1"], "shot_type": "closeup"}},
   "expect": {"generation_kind": "image_to_video"}},
  {"id": "uses-canonical-description-verbatim",
   "input": {"shot": {"character_ids": ["c1"], "preferred_generation_kind": "text_to_video"},
             "character": {"id": "c1", "canonical": "shoulder-length dark brown hair, centre parted"}},
   "expect": {"contains_all": ["shoulder-length dark brown hair"]}},
  {"id": "never-restates-appearance-in-i2v",
   "input": {"shot": {"character_ids": ["c1"], "preferred_generation_kind": "image_to_video"},
             "character": {"id": "c1", "canonical": "dark brown hair"}},
   "expect": {"not_contains": ["dark brown hair"]}}
]""")),

"face-consistency": dict(
    name="Face Consistency", status="active",
    description="Keep facial structure stable where it is most fragile.",
    requires_skills=["character-identity-lock"],
    body="""
Faces drift in a predictable order: first the softest features, then the
structure. Watching for them in that order catches drift while it is still
cheap to fix.

Most fragile, roughly in order:

1. Eyebrow shape and spacing
2. Nose width at the bridge
3. Jaw and chin definition
4. Eye spacing and shape
5. Lip fullness and mouth width

Structural features -- eye spacing, jaw, nose bridge -- matter more than
colouring. A viewer will accept a slight shift in hair tone and will not accept
a face whose proportions changed.

Practical measures: use a three-quarter reference rather than a full-frontal
one, because three-quarter carries more structural information. Keep faces
above roughly a fifth of frame height where identity must hold; below that
there is not enough resolution to preserve structure. And prefer shorter shots
for close-ups, since face drift accumulates over a generation.
""",
    eval=ev("""[
  {"id": "prefers-three-quarter-reference",
   "input": {"shot": {"character_ids": ["c1"], "requires_identity_lock": true}},
   "expect": {"reference_view_in": ["three_quarter_left", "three_quarter_right"]}},
  {"id": "flags-a-face-too-small-to-hold",
   "input": {"shot": {"shot_type": "wide", "requires_identity_lock": true}},
   "expect": {"flags_insufficient_face_size": true}}
]""")),

"body-consistency": dict(
    name="Body Consistency", status="active",
    description="Keep build, proportion and height stable across shots.",
    requires_skills=["character-identity-lock"],
    body="""
Bodies drift more freely than faces because prompts rarely constrain them, and
the drift shows most in comparison across a cut.

Fix in the Scene Bible and hold: height relative to the environment, build,
shoulder width relative to hips, and posture.

Height is the one that gives it away. A character who reaches a counter at
mid-torso in one shot and at hip level in the next has changed size, and the
cut makes it obvious. Where a character relates to a fixed object, say how.

Posture is part of identity. Someone who stands with weight on one hip in their
reference and squarely in the next shot reads as a different person even when
every feature matches.
""",
    eval=ev("""[
  {"id": "anchors-height-to-the-environment",
   "input": {"shot": {"character_ids": ["c1"], "location_id": "l1"}},
   "expect": {"has_height_anchor": true}},
  {"id": "carries-posture-from-the-bible",
   "input": {"shot": {"character_ids": ["c1"]}, "character": {"id": "c1", "posture": "weight on left hip"}},
   "expect": {"contains_any": ["weight on left hip"]}}
]""")),

"clothing-consistency": dict(
    name="Clothing Consistency", status="active",
    description="Keep wardrobe identical within a scene and deliberate across scenes.",
    requires_skills=["character-identity-lock"],
    body="""
Within a scene, clothing must be identical. Not similar: identical. A jacket
that changes shade between two shots of the same conversation is a continuity
error a viewer will spot even if they cannot name it.

Specify the parts that drift: exact colour including its value, closure state
(buttoned, open, half-zipped), sleeve position, and whether it is tucked. These
are what generation varies when unconstrained.

Across scenes, a change of clothing signals a change of time. If a script does
not intend to imply that time passed, the wardrobe should not change.

Watch for a specific failure: a garment described as one colour rendering as a
similar colour under different lighting per shot. Name the colour by its
material appearance -- "faded olive cotton" rather than "green" -- so lighting
changes the light on it and not the garment.
""",
    eval=ev("""[
  {"id": "specifies-closure-state",
   "input": {"shot": {"character_ids": ["c1"]}, "character": {"id": "c1", "clothes": "denim jacket"}},
   "expect": {"has_closure_state": true}},
  {"id": "holds-identical-within-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"identical_wardrobe": true}}
]""")),

"product-identity": dict(
    name="Product Identity", status="active", modes=["PRODUCT"],
    description="Keep a product's shape, proportion and colour exactly as it is.",
    body="""
A product is not a subject the model may interpret. It is a specific object that
exists, and a client will compare the output against it.

Hold four things:

- **Proportion.** Height against width against depth. Wide lenses change these,
  which is why product shots avoid them.
- **Silhouette.** Cap shape, shoulder curve, base. The outline is what a viewer
  recognises before any detail.
- **Colour.** By reference, not by name. "Green" covers thousands of products;
  the pack has one.
- **Material.** Glass, matte plastic and coated aluminium respond to light in
  ways that are unmistakable, and getting it wrong makes the product look cheap.

Always generate a keyframe from the approved product reference and drive the
video from it. Text-to-video for a real product is not a shortcut; it is a
guess, and it will not match.

Prefer shorter shots. Product fidelity degrades over a generation faster than
almost anything else.
""",
    eval=ev("""[
  {"id": "requires-a-keyframe",
   "input": {"shot": {"requires_product_fidelity": true}},
   "expect": {"generation_kind": "image_to_video"}},
  {"id": "specifies-material",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "material": "frosted glass"}},
   "expect": {"contains_any": ["frosted glass"]}},
  {"id": "colour-by-reference-not-by-name",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "colors": ["#1B7F4B"]}},
   "expect": {"uses_reference_colour": true}}
]""")),

"product-logo-preservation": dict(
    name="Product Logo Preservation", status="active", modes=["PRODUCT"],
    description="Keep a logo legible and correct, or keep it out of frame.",
    requires_skills=["product-identity"],
    body="""
Logos are the hardest thing for a video model to hold and the most damaging to
get wrong. A warped logo is worse than no logo: it looks like a counterfeit.

Give the generation the best chance:

- Frame the logo flat to camera. Angled and curved surfaces are where it warps.
- Keep it large enough to resolve. A logo occupying a small fraction of frame
  width will not survive.
- Keep the shot short. Logo integrity degrades noticeably over a long
  generation.
- Hold the reference strength high, above 0.9.
- Avoid motion across the logo. A camera move over a logo is a warp waiting to
  happen.

When the shot cannot meet these conditions, the correct answer is to compose so
the logo is turned away or out of frame, and to place a clean product shot
elsewhere in the edit. A deliberate choice not to show it beats an accidental
mangling of it.
""",
    eval=ev("""[
  {"id": "requires-flat-framing",
   "input": {"shot": {"product_ids": ["p1"], "requires_product_fidelity": true}},
   "expect": {"has_flat_framing": true}},
  {"id": "turns-the-logo-away-when-conditions-are-poor",
   "input": {"shot": {"product_ids": ["p1"], "duration_frames": 240, "motion_complexity": 0.9}},
   "expect": {"hides_logo": true}}
]""")),

"product-text-preservation": dict(
    name="Product Text Preservation", status="active", modes=["PRODUCT"],
    description="Keep on-pack text readable and correct, or keep it out of frame.",
    requires_skills=["product-identity"],
    body="""
Text degrades before logos do. Small type on a pack will be garbled in most
generations, and garbled text on a product is an immediate credibility failure.

Decide per shot which text must be readable, and accept that everything else
will not be. Usually that is the brand name and one claim, at most.

For text that must read:

- Frame it flat and large.
- State the exact strings in the keyframe prompt so the image model has them.
- Hold reference strength at 0.9 or above.
- Keep the shot under about three seconds.
- Do not move the camera across it.

For everything else, compose so it is small, angled or out of focus. Text that
is clearly not meant to be read is not a defect; text that is nearly readable
and wrong is.

Verify with the text-preservation judge before accepting the shot. Do not rely
on it looking right at a glance -- it usually does.
""",
    eval=ev("""[
  {"id": "states-exact-strings",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C"]}},
   "expect": {"contains_all": ["NOVA", "15% Vitamin C"]}},
  {"id": "limits-readable-text",
   "input": {"shot": {"product_ids": ["p1"]},
             "product": {"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C", "30ml", "made in sweden", "batch 4471"]}},
   "expect": {"max_readable_strings": 2}},
  {"id": "keeps-text-shots-short",
   "input": {"shot": {"product_ids": ["p1"], "duration_frames": 240, "requires_product_fidelity": true}},
   "expect": {"flags_duration": true}}
]""")),

"location-continuity": dict(
    name="Location Continuity", status="active",
    description="Keep a place recognisably the same place across the shots set in it.",
    body="""
A location that changes between shots breaks a scene as surely as a face that
does. It is easier to miss because no single shot looks wrong.

Hold across every shot in a scene: architecture and layout, the direction light
comes from, time of day, weather, and any object established as being present.

The light direction is the one most often lost. Sun through a window on the left
in one shot and on the right in the next tells the viewer these are different
rooms, or different days.

Persistent objects are the second. A vase on the table in the wide shot must be
on the table in the close-up. List them in the Scene Bible and carry them into
every prompt for that location.

Where a scene genuinely spans time, make it deliberate and visible -- the light
shifts, and the script supports it. Accidental time travel is the failure.
""",
    eval=ev("""[
  {"id": "holds-light-direction-across-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"consistent_light_direction": true}},
  {"id": "carries-persistent-objects",
   "input": {"shot": {"location_id": "l1"}, "location": {"id": "l1", "persistent_objects": ["a vase of dried flowers"]}},
   "expect": {"contains_any": ["vase"]}}
]""")),
}

MOTION = {
"human-motion-director": dict(
    name="Human Motion Director", status="active",
    description="Coordinate how a person moves so the whole body participates.",
    requires_skills=["natural-motion"],
    body="""
Generated humans move from the limbs outward: the arm reaches and nothing else
changes. Real bodies move from the centre.

For any human movement, describe what the core does. Reaching involves the
shoulders and a shift of weight. Turning starts at the head, then the shoulders,
then the hips. Standing from a chair is led by the torso coming forward.

Keep one movement per shot, with a clear beginning and a clear settle. Movements
that neither start nor end within the shot read as fragments.

Give the movement a reason. A person who moves because the script needs
movement moves like a puppet; a person who moves to reach something, to see
something, or to get out of the way moves like a person.

Where two people interact, describe the interaction from one side only. Two
independently described bodies produce the merged-limb failures that anatomy
judges catch.
""",
    eval=ev("""[
  {"id": "involves-the-core",
   "input": {"shot": {"action": "she reaches for the top shelf"}},
   "expect": {"has_core_involvement": true}},
  {"id": "describes-interaction-from-one-side",
   "input": {"shot": {"action": "they shake hands", "character_ids": ["c1", "c2"]}},
   "expect": {"single_perspective": true}}
]""")),

"walking-director": dict(
    name="Walking Director", status="active",
    description="Make walking read as walking rather than as sliding.",
    requires_skills=["human-motion-director"],
    body="""
Walking is the movement generated video fails at most visibly, because everyone
knows what it looks like.

The failures are specific: feet that do not contact the ground, a gait whose
cadence does not match the translation speed, and a body that stays perfectly
level.

Ask for the contact. "Her weight settles onto each step" gives the model
something the sliding failure cannot satisfy.

Ask for the vertical. Walking bounces slightly; a perfectly level head means the
body is being translated rather than walking.

Prefer lateral or diagonal movement across frame over walking directly toward
camera. Toward-camera walking requires consistent scale change and is where
proportion drift shows worst.

Keep walking shots short. Cadence errors accumulate, and a four-second walk is
far more likely to read correctly than a ten-second one.
""",
    eval=ev("""[
  {"id": "asks-for-ground-contact",
   "input": {"shot": {"action": "he walks across the room"}},
   "expect": {"has_contact_clause": true}},
  {"id": "prefers-lateral-movement",
   "input": {"shot": {"action": "she walks toward the camera"}},
   "expect": {"suggests_lateral": true}}
]""")),

"hand-interaction": dict(
    name="Hand Interaction", status="active",
    description="Handle the hardest thing generated video does: hands touching objects.",
    body="""
Hands are the most common visible defect, and hands holding something are worse
than hands alone, because the contact has to be geometrically right.

Reduce the difficulty rather than trying to prompt through it:

- **Establish the grip before the shot starts.** A keyframe where the hand
  already holds the object is far more reliable than a generation that must
  form the grip mid-shot.
- **Keep the hand partly out of frame or partly occluded** where the shot
  allows. A hand entering from the edge with two fingers visible is much safer
  than a full open palm.
- **Avoid finger-counting shots.** Open palms facing camera are where extra
  fingers appear.
- **Keep the object large enough** that the grip is unambiguous. Small objects
  produce vague, melting contact.
- **Keep it short.** Hand integrity degrades quickly.

Where the shot needs a clean hand-on-product moment and cannot get it, an insert
shot generated from a still is usually better than a failing action shot.
""",
    eval=ev("""[
  {"id": "prefers-a-pre-established-grip",
   "input": {"shot": {"action": "she picks up the bottle"}},
   "expect": {"suggests_keyframe_grip": true}},
  {"id": "avoids-open-palm-to-camera",
   "input": {"shot": {"action": "he holds his palm up to camera"}},
   "expect": {"flags_finger_risk": true}}
]""")),

"product-handling": dict(
    name="Product Handling", status="active", modes=["PRODUCT", "UGC"],
    description="Show a product being used without losing either the product or the hand.",
    requires_skills=["hand-interaction", "product-identity"],
    body="""
Product handling asks for the two hardest things at once: a correct hand and a
correct product, in contact.

Sequence it as separate shots rather than one:

1. The product at rest, clean and legible. Identity is established here.
2. The hand approaching or already holding it, framed so the grip is simple.
3. The use itself -- pumping, opening, applying -- with the product possibly
   partly out of frame.
4. The result, if there is one.

That sequence is also better filmmaking than a single continuous take, which is
convenient: the constraint and the craft point the same way.

In the handling shots, accept that pack text may not hold, and do not frame it
to be read. Legibility was established in shot one.

Match the grip to the object. A pump bottle is held around the body with a
finger on the pump; a jar is held from beneath and opened with the other hand.
Wrong grips read as strange even when the anatomy is fine.
""",
    eval=ev("""[
  {"id": "splits-into-a-sequence",
   "input": {"shot": {"action": "she picks up the bottle, pumps it and applies it"}},
   "expect": {"suggests_split": true, "min_shots": 3}},
  {"id": "does-not-require-legible-text-during-handling",
   "input": {"shot": {"action": "she pumps the bottle", "product_ids": ["p1"]}},
   "expect": {"requires_readable_text": false}}
]""")),

"body-language": dict(
    name="Body Language", status="active",
    description="Give a person an attitude that matches what they are saying.",
    body="""
A body that contradicts the words is worse than a neutral one. Confidence
delivered with closed, defensive posture reads as a lie, and viewers respond to
it without knowing why.

Match posture to intent:

- **Open and forward** -- leaning slightly in, shoulders back, hands visible --
  for enthusiasm and sincerity.
- **Settled and still** -- weight even, minimal gesture -- for authority.
- **Closed and small** -- arms crossed, shoulders drawn in -- for scepticism or
  discomfort, which is what a testimonial's opening beat often needs.

Let it change across a shot where the line changes. A testimonial that opens
sceptical and ends convinced should show that in the body, not only the face.

Keep gestures below the level of the words. Generated presenters gesture
constantly and identically, which is the most recognisable avatar tell. One
deliberate gesture in a shot is more convincing than continuous motion.
""",
    eval=ev("""[
  {"id": "matches-posture-to-intent",
   "input": {"shot": {"action": "she says she was sceptical at first"}},
   "expect": {"posture_in": ["closed", "guarded", "small"]}},
  {"id": "keeps-gestures-sparse",
   "input": {"shot": {"action": "he explains the feature", "duration_frames": 96}},
   "expect": {"max_gestures": 2}}
]""")),
}

write_all("identity", IDENTITY)
write_all("motion", MOTION)
