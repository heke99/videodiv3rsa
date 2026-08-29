import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

SKILLS = {
"prompt-normalizer": dict(
    name="Prompt Normalizer", status="active",
    description="Strip a raw description down to what a generator can act on, before any model-specific compiler runs.",
    body="""
Take the shot's description and action and reduce them to concrete, visible
facts. Everything you keep must be something a camera could photograph.

Remove:
- Intent and evaluation. "A stunning, breathtaking shot that really sells the
  product" tells a video model nothing; it has no way to render *stunning*.
- Story context the frame cannot show. "She has been struggling with this for
  months" is backstory. What is visible is her expression and posture now.
- Redundant adjective stacks. "beautiful gorgeous elegant woman" is one weak
  signal repeated three times, and it crowds out the specific detail that would
  actually have helped.

Keep and sharpen:
- Subject, and what the subject is doing, as a single continuous action.
- Where they are, and what is behind them.
- Light: its direction, its hardness, its colour.
- What the camera is doing, if anything.

State one action per shot. If the description contains a sequence -- she picks
it up, examines it, then sets it down -- that is a planning error that should
have been split into separate shots, and compiling it into one prompt produces
a model best-guessing which part to render.

Output plain declarative sentences in present tense. No lists, no headings, no
parenthetical asides.
""",
    schema={"input": {"type": "object", "required": ["description", "action"],
                      "properties": {"description": {"type": "string"}, "action": {"type": "string"}}},
            "output": {"type": "object", "properties": {"normalized": {"type": "string"}}}},
    eval="""
# Eval

The normalizer must remove unrenderable language and keep visual specifics.

```json
[
  {"id": "strips-evaluative-language",
   "input": {"description": "A stunning breathtaking shot of a beautiful woman", "action": "she smiles"},
   "expect": {"not_contains": ["stunning", "breathtaking"], "contains_any": ["woman", "smile"]}},
  {"id": "keeps-light-direction",
   "input": {"description": "Backlit by a low sun through a window", "action": "she turns"},
   "expect": {"contains_any": ["backlit", "sun", "window"]}},
  {"id": "flags-multi-action",
   "input": {"description": "Kitchen", "action": "she picks it up, examines it, then sets it down"},
   "expect": {"single_action": true}}
]
```
"""),

"negative-instruction-builder": dict(
    name="Negative Instruction Builder", status="active",
    description="Build a negative prompt from what this specific shot can plausibly get wrong, not from a boilerplate list.",
    body="""
A negative prompt is a budget. Every term you add dilutes the others, so a
hundred-word list of everything bad that has ever happened is weaker than six
terms aimed at this shot's actual failure modes.

Choose terms from what the shot contains:

- Hands visible and interacting with something: malformed hands, extra fingers,
  fused fingers.
- More than one person: merged bodies, duplicated faces, extra limbs.
- A face in close-up: distorted features, asymmetric eyes, waxy skin.
- Readable text or a logo on a product: garbled text, misspelled text, warped
  logo.
- Any camera movement: warping background, morphing geometry.
- A static or near-static subject: frozen frame, no motion.

Do not add terms for things the shot does not contain. "Extra fingers" on a
landscape establishing shot spends budget on an impossibility.

Never add quality words to the negative prompt as a reflex -- low quality,
blurry, jpeg artifacts. Modern video models do not respond to them the way
image models once did, and they occupy space that a real failure mode needed.
""",
    schema={"input": {"type": "object", "properties": {"shot": {"type": "object"}}},
            "output": {"type": "object", "properties": {"negative_prompt": {"type": "string"}}}},
    eval="""
# Eval

Negative terms must be selected by what the shot contains.

```json
[
  {"id": "hands-shot-gets-hand-terms",
   "input": {"shot": {"description": "close on her hands opening the jar"}},
   "expect": {"contains_any": ["finger", "hand"]}},
  {"id": "landscape-does-not-get-hand-terms",
   "input": {"shot": {"description": "wide establishing shot of an empty valley at dawn"}},
   "expect": {"not_contains": ["finger", "extra limbs"]}},
  {"id": "stays-short",
   "input": {"shot": {"description": "a man walks across a room"}},
   "expect": {"max_terms": 8}}
]
```
"""),

"seed-planner": dict(
    name="Seed Planner", status="active",
    description="Assign seeds so retries explore and continuations stay consistent.",
    body="""
A seed is the difference between a retry that might work and a retry that
reproduces the same failure.

Rules:

- A regeneration after a quality failure gets a **new** seed. Re-rolling the
  same seed with the same prompt returns the same output, so retrying without
  changing the seed wastes the attempt entirely.
- A repair that keeps most of the shot -- lip sync, a local fix -- keeps the
  **same** seed. The point of a repair is that everything else stays as it was.
- Shots that must match each other, such as a reverse angle of the same moment,
  share a seed so their noise structure agrees.
- A user asking for "another take of the same idea" gets a new seed with an
  unchanged prompt. That is precisely what a seed is for.

Record the seed on the attempt. A shot the user liked and cannot reproduce is a
worse outcome than a shot that failed.
""",
    schema={"input": {"type": "object", "properties": {"reason": {"type": "string"}, "previous_seed": {"type": "integer"}}},
            "output": {"type": "object", "properties": {"seed": {"type": "integer"}, "rationale": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "quality-retry-changes-seed",
   "input": {"reason": "quality_failure", "previous_seed": 12345},
   "expect": {"seed_differs_from_previous": true}},
  {"id": "lipsync-repair-keeps-seed",
   "input": {"reason": "lipsync_repair", "previous_seed": 12345},
   "expect": {"seed": 12345}}
]
```
"""),

"reference-strength-planner": dict(
    name="Reference Strength Planner", status="active",
    description="Decide how hard a reference image should constrain the generation.",
    body="""
Reference strength trades identity against motion. Held too tight, the subject
is unmistakably right and barely moves; too loose, the shot moves well and the
face drifts.

Start from what the shot is for:

- **Identity-critical, little movement** (a talking head, a product hero):
  0.85 to 0.95. The reference is the point.
- **Identity-critical with real movement** (a character walking through a
  scene): 0.6 to 0.75. Above this the model fights its own motion prior and
  produces the stiff, sliding look that reads instantly as generated.
- **Composition guidance only** (matching a framing or a palette): 0.3 to 0.45.
- **Product with readable text or a logo**: 0.9 or above, and prefer a shorter
  shot. Pack text degrades faster than faces do, and no repair recovers it.

When identity and motion genuinely conflict, split the shot rather than
compromising: a held frame for the identity beat, a looser shot for the
movement. That is almost always better than one shot that does neither well.
""",
    schema={"input": {"type": "object", "properties": {"shot": {"type": "object"}}},
            "output": {"type": "object", "properties": {"strength": {"type": "number"}, "rationale": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "talking-head-holds-tight",
   "input": {"shot": {"requires_identity_lock": true, "motion_complexity": 0.1}},
   "expect": {"strength_min": 0.8}},
  {"id": "walking-character-loosens",
   "input": {"shot": {"requires_identity_lock": true, "motion_complexity": 0.8}},
   "expect": {"strength_max": 0.8}},
  {"id": "product-text-holds-tightest",
   "input": {"shot": {"requires_product_fidelity": true}},
   "expect": {"strength_min": 0.9}}
]
```
"""),

"camera-language-translator": dict(
    name="Camera Language Translator", status="active",
    description="Turn film-crew camera vocabulary into description a video model responds to.",
    body="""
Video models are trained on described footage, not on call sheets. They have
seen far more captions saying "the camera slowly moves closer" than captions
saying "slow push in on a 50mm".

Translate the intent, keep the result:

- Dolly in / push in -> the camera moves steadily closer to her
- Dolly out / pull back -> the camera draws back, revealing the room around him
- Truck / crab left -> the camera glides sideways past the shelves
- Pan -> the camera turns to follow her across the room
- Tilt up -> the camera tips upward from his hands to his face
- Crane up -> the camera rises above the crowd
- Handheld -> the frame drifts and settles slightly, as if hand-held
- Locked off -> the camera does not move
- Rack focus -> focus shifts from the bottle in front to her face behind

Two failure modes to avoid. Naming a lens length does nothing on its own:
describe the effect instead -- compressed background, or a wide field with
visible edge distortion. And stacking movements in one shot ("pan while
pushing in and craning up") produces incoherent motion; pick the one that
carries the shot.
""",
    schema={"input": {"type": "object", "properties": {"camera": {"type": "object"}}},
            "output": {"type": "object", "properties": {"description": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "translates-dolly",
   "input": {"camera": {"movement": "dolly in"}},
   "expect": {"contains_any": ["moves", "closer"], "not_contains": ["dolly"]}},
  {"id": "static-says-so-plainly",
   "input": {"camera": {"movement": "static"}},
   "expect": {"contains_any": ["does not move", "static frame", "still"]}},
  {"id": "refuses-stacked-movement",
   "input": {"camera": {"movement": "pan while pushing in and craning up"}},
   "expect": {"single_movement": true}}
]
```
"""),

"motion-language-translator": dict(
    name="Motion Language Translator", status="active",
    description="Describe how a subject moves in terms a generator can follow.",
    body="""
Motion prompts fail in a particular way: they describe the endpoint instead of
the movement, and the model renders a still of the endpoint.

Write the movement, not the outcome:

- Weak: "she has picked up the bottle"
- Strong: "she reaches for the bottle and lifts it toward her"

Anchor speed to something physical. "Slowly" is relative; "at a walking pace"
and "in a single unhurried motion" are not.

Give the body a direction of travel and a weight. A person crossing a room
shifts their weight; a person turning leads with their head and the shoulders
follow. Models reproduce these cues when they are present and produce the
gliding, weightless look when they are absent.

Keep it to one continuous movement per shot. Where a second movement is
genuinely needed, it belongs in the next shot.
""",
    schema={"input": {"type": "object", "properties": {"action": {"type": "string"}}},
            "output": {"type": "object", "properties": {"description": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "converts-endpoint-to-movement",
   "input": {"action": "she has picked up the bottle"},
   "expect": {"contains_any": ["reaches", "lifts", "picks up"]}},
  {"id": "anchors-speed",
   "input": {"action": "he walks slowly across the room"},
   "expect": {"contains_any": ["walking pace", "unhurried", "steady"]}}
]
```
"""),
}

write_all("prompt", SKILLS)
