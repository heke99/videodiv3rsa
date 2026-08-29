import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

COMMON_DEPS = ["prompt-normalizer", "negative-instruction-builder", "seed-planner"]

SKILLS = {
"wan-t2v-prompt": dict(
    name="Wan T2V Prompt Compiler", status="active",
    description="Compile a shot into a Wan2.2 text-to-video prompt, where every element must be established by language alone.",
    supported_models=["wan2.2-t2v-a14b"], requires_skills=COMMON_DEPS + ["camera-language-translator"],
    generation_kinds=["text_to_video"],
    body="""
Text-to-video has no reference to fall back on, so everything the shot needs
must be established in the prompt. That makes this compiler the most
information-dense of the family, and the most vulnerable to a missing detail.

Order matters. Wan attends most strongly to the opening of the prompt, so lead
with the subject and its action, then the environment, then light, then camera.
A prompt that opens with three sentences of atmosphere and reaches the subject
last will render the atmosphere.

Structure:

1. **Subject and action** in one sentence, present tense, one continuous
   movement.
2. **Environment** -- the location, and specifically what is behind the subject.
   Backgrounds left unspecified come out as grey nothing or as a lucky guess
   that changes between shots.
3. **Light** -- direction, hardness, colour. This is the single strongest lever
   over whether the result reads as footage or as render.
4. **Camera** -- one movement, or explicitly none.

Use this path for establishing shots, environments and anything with no
recurring character or product. The moment identity or product fidelity
matters, the router should have chosen image-to-video instead, and a T2V prompt
attempting to describe a specific person is the failure that produces a
different face in every shot.

Keep the whole prompt under roughly 80 words. Beyond that Wan's attention
spreads and later clauses stop landing.
""",
    schema={"input": {"type": "object", "required": ["shot"], "properties": {"shot": {"type": "object"}, "style": {"type": "object"}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}, "negative_prompt": {"type": "string"}}}},
    eval="""
# Eval

The T2V compiler must front-load the subject and never claim a specific identity.

```json
[
  {"id": "leads-with-subject",
   "input": {"shot": {"description": "a quiet street at dawn", "action": "a cyclist rides past"}},
   "expect": {"subject_in_first_sentence": true}},
  {"id": "always-specifies-background",
   "input": {"shot": {"description": "a man stands", "action": "he looks up"}},
   "expect": {"has_environment_clause": true}},
  {"id": "always-specifies-light",
   "input": {"shot": {"description": "a kitchen", "action": "steam rises from a cup"}},
   "expect": {"has_light_clause": true}},
  {"id": "does-not-name-a-canonical-character",
   "input": {"shot": {"description": "character_001 walks", "character_ids": ["character_001"]}},
   "expect": {"not_contains": ["character_001"]}},
  {"id": "stays-under-length-budget",
   "input": {"shot": {"description": "a busy market", "action": "a vendor arranges fruit"}},
   "expect": {"max_words": 80}}
]
```
"""),

"wan-i2v-prompt": dict(
    name="Wan I2V Prompt Compiler", status="active",
    description="Compile a shot into a Wan2.2 image-to-video prompt, where the keyframe carries appearance and the prompt carries only motion.",
    supported_models=["wan2.2-i2v-a14b"], requires_skills=COMMON_DEPS + ["motion-language-translator", "reference-strength-planner"],
    generation_kinds=["image_to_video"],
    body="""
The keyframe already establishes who, what and where. The prompt's job is
what happens next, and nothing else.

This is the discipline that makes image-to-video work, and the most common way
it is thrown away: re-describing the subject. If the keyframe shows a woman in
a green coat and the prompt also says "a woman in a green coat", the model now
has two sources for her appearance and will blend them. The coat shifts shade,
the face drifts, and the identity lock the keyframe was there to provide is
gone.

Write:

1. **The movement** -- what the subject does, starting from the pose in the
   frame. Continuity with the keyframe is what makes the first frames stable.
2. **What the camera does**, if anything.
3. **What changes in the scene**, if anything -- light shifting, a door
   opening behind.

Do not write: hair colour, clothing, facial features, the product's shape or
label, the room's contents. All of it is already in the frame.

Two further rules. Reference an object the keyframe does not contain and the
model must invent it mid-shot, which looks exactly as bad as it sounds. And
keep the motion within what one shot can hold: image-to-video degrades toward
the end of a long generation, and the keyframe's authority fades with it.
""",
    schema={"input": {"type": "object", "required": ["shot"], "properties": {"shot": {"type": "object"}, "keyframe": {"type": "object"}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}, "negative_prompt": {"type": "string"}, "reference_strength": {"type": "number"}}}},
    eval="""
# Eval

The defining behaviour: appearance belongs to the keyframe, not the prompt.

```json
[
  {"id": "does-not-redescribe-appearance",
   "input": {"shot": {"description": "a woman in a green coat", "action": "she turns to look behind her"},
             "keyframe": {"asset_id": "kf1"}},
   "expect": {"not_contains": ["green coat", "woman in"], "contains_any": ["turns", "looks"]}},
  {"id": "describes-motion-from-the-frame",
   "input": {"shot": {"action": "she lifts the bottle"}, "keyframe": {"asset_id": "kf1"}},
   "expect": {"contains_any": ["lifts", "raises"]}},
  {"id": "does-not-introduce-absent-objects",
   "input": {"shot": {"action": "she picks up a cat that is not in frame"}, "keyframe": {"asset_id": "kf1"}},
   "expect": {"flags_absent_object": true}},
  {"id": "is-shorter-than-the-t2v-equivalent",
   "input": {"shot": {"action": "he walks forward"}, "keyframe": {"asset_id": "kf1"}},
   "expect": {"max_words": 45}}
]
```
"""),

"wan-s2v-prompt": dict(
    name="Wan S2V Prompt Compiler", status="active",
    description="Compile a talking shot for Wan2.2 S2V, where the audio drives the mouth and the prompt drives everything else.",
    supported_models=["wan2.2-s2v-14b"], requires_skills=COMMON_DEPS + ["creator-eye-contact", "facial-expression"],
    generation_kinds=["speech_to_video"],
    body="""
The driving audio controls the mouth. Describing speech in the prompt does not
help and actively hurts: the model receives one instruction from the waveform
and a second from the text, and the mouth becomes less accurate, not more.

Never write: "she speaks", "he is talking", "mouth moving", "lip synced".

Write what the audio cannot carry:

1. **Everything below the neck and behind the subject.** Posture, whether they
   gesture, what is behind them. Speech-driven models animate the face well and
   leave the body inert unless told otherwise, and an inert body under an
   animated face is a large part of why avatar video reads as fake.
2. **Where they are looking.** Down the lens for direct address, slightly off
   for a more natural read. This single choice does more for whether a talking
   shot works than almost anything else.
3. **Expression across the line, not at a moment.** "Warm, becoming more
   certain as she goes" gives the model an arc; "smiling" gives it a mask held
   for the whole shot.
4. **Light and framing**, as normal.

Keep gestures sparse and specific. One hand movement described precisely beats
"gesturing naturally", which produces the continuous vague hand-waving that is
the tell of generated presenter footage.
""",
    schema={"input": {"type": "object", "required": ["shot", "dialogue"], "properties": {"shot": {"type": "object"}, "dialogue": {"type": "object"}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}, "negative_prompt": {"type": "string"}}}},
    eval="""
# Eval

The audio owns the mouth; the prompt must not compete with it.

```json
[
  {"id": "never-describes-speaking",
   "input": {"shot": {"description": "a creator to camera"}, "dialogue": {"text": "I gave up on retinol twice"}},
   "expect": {"not_contains": ["speaks", "talking", "mouth", "lip sync"]}},
  {"id": "specifies-gaze",
   "input": {"shot": {"description": "a creator to camera"}, "dialogue": {"text": "hi"}},
   "expect": {"has_gaze_clause": true}},
  {"id": "gives-the-body-something-to-do",
   "input": {"shot": {"description": "a founder at a desk"}, "dialogue": {"text": "we started this in 2019"}},
   "expect": {"has_posture_or_gesture_clause": true}},
  {"id": "expression-is-an-arc-not-a-mask",
   "input": {"shot": {"description": "testimonial"}, "dialogue": {"text": "honestly I did not expect it to work", "emotion": "sceptical to convinced"}},
   "expect": {"contains_any": ["becoming", "shifts", "as she", "as he", "by the end"]}}
]
```
"""),

"wan-animate-prompt": dict(
    name="Wan Animate Prompt Compiler", status="active",
    description="Compile a character-animation shot for Wan2.2 Animate, where a reference drives body motion.",
    supported_models=["wan2.2-animate-14b"], requires_skills=COMMON_DEPS + ["human-motion-director"],
    generation_kinds=["character_animation"],
    body="""
Animate follows a reference for the character and produces deliberate body
movement. The prompt describes the movement's quality, not its geometry: the
reference already carries the body.

Write the *manner* of the motion:

- weight and effort -- does this cost her anything, or is it easy
- tempo -- and anchor it to something physical, not to an adverb
- what leads -- the hand, the shoulders, the eyes
- where it settles -- movement that stops cleanly reads as real; movement that
  drifts to a halt reads as generated

Do not restate the character's appearance. That is the reference's job, and
restating it produces the same blending failure as in image-to-video.

Do not stack actions. Animate holds one movement well and degrades sharply on
two, which is a planning problem rather than a prompting one: split the shot.
""",
    schema={"input": {"type": "object", "properties": {"shot": {"type": "object"}, "reference": {"type": "object"}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}, "negative_prompt": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "describes-manner-not-appearance",
   "input": {"shot": {"action": "she reaches for the shelf"}, "reference": {"asset_id": "r1"}},
   "expect": {"contains_any": ["reaches"], "not_contains": ["wearing", "hair"]}},
  {"id": "refuses-stacked-actions",
   "input": {"shot": {"action": "he stands, walks over and sits down"}, "reference": {"asset_id": "r1"}},
   "expect": {"single_action": true}}
]
```
"""),

"qwen-image-prompt": dict(
    name="Qwen Image Prompt Compiler", status="active",
    description="Compile a keyframe or reference still, where every detail must survive into the video that follows.",
    supported_models=["qwen-image-2"], requires_skills=COMMON_DEPS + ["framing-director", "lighting-director"],
    generation_kinds=["image"],
    body="""
A keyframe is not a picture; it is the specification the video model will spend
the whole shot trying to hold. Anything vague here becomes drift there.

Be specific in the places video models lose first:

- **Face**: structure, not adjectives. "Wide-set eyes, a slightly crooked nose,
  a small scar through the left eyebrow" survives a generation. "Beautiful"
  does not.
- **Hands**: if they will be visible in the shot, put them in a clear,
  unambiguous position in the frame. Hands entering a shot from an unclear
  starting pose are where hand artifacts come from.
- **Product text and logo**: state them exactly, and frame the product so they
  are legible and unforeshortened. Text that is small or angled in the keyframe
  is text that will be garbled in the video.
- **Light**: direction, hardness, colour temperature, and where the shadows
  fall. The video model will hold whatever lighting the keyframe establishes.

Compose for what comes next. Leave the room in frame that the movement needs;
a keyframe cropped tight around a subject who is about to walk forward forces
the video model to invent the space she walks into.

For an edit rather than a generation, describe only the change. Restating the
parts that should stay is how they change.
""",
    schema={"input": {"type": "object", "properties": {"shot": {"type": "object"}, "entities": {"type": "object"}, "mode": {"type": "string", "enum": ["generate", "edit"]}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}, "negative_prompt": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "face-is-structural-not-evaluative",
   "input": {"shot": {"description": "portrait of the creator"}, "entities": {"characters": [{"id": "c1"}]}},
   "expect": {"not_contains": ["beautiful", "gorgeous", "stunning"]}},
  {"id": "product-text-is-stated-exactly",
   "input": {"shot": {"description": "the bottle on marble", "requires_product_fidelity": true},
             "entities": {"products": [{"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C"]}]}},
   "expect": {"contains_all": ["NOVA", "15% Vitamin C"]}},
  {"id": "edit-mode-describes-only-the-change",
   "input": {"shot": {"description": "change the background to a bathroom"}, "mode": "edit"},
   "expect": {"max_words": 30}},
  {"id": "leaves-room-for-the-movement",
   "input": {"shot": {"description": "she is about to walk forward", "action": "walks toward camera"}},
   "expect": {"has_headroom_clause": true}}
]
```
"""),

"tts-prompt": dict(
    name="TTS Prompt Compiler", status="active",
    description="Prepare a dialogue line for speech generation, including how it should be delivered.",
    supported_models=["qwen3-tts"], requires_skills=["speech-director", "pronunciation-planner"],
    body="""
The text you send is spoken literally, so it must be the spoken form, not the
written one.

Convert before sending:

- Numerals to words, in the form a person would say them. "15%" is "fifteen
  percent"; "2019" is "twenty nineteen", not "two thousand and nineteen",
  unless the script's register calls for it.
- Symbols and abbreviations. "&" is "and". "Dr." is "doctor" or "drive"
  depending on context, and getting that wrong is audible.
- URLs and handles to how they are said aloud.

Mark delivery separately from text. Emotion, pace and emphasis belong in the
delivery fields; embedding stage directions in the text means hearing the model
read "(warmly)" out loud.

Punctuate for breath, not for grammar. A comma where a speaker would pause is
correct even where a copy editor would remove it. Sentences longer than about
twenty words will be delivered in one breath and sound like it.

Pass pronunciation hints for names, brands and anything ambiguous. A brand name
mispronounced consistently across a campaign is worse than one mispronounced
once, and it is the failure a client notices first.
""",
    schema={"input": {"type": "object", "properties": {"line": {"type": "object"}, "voice": {"type": "object"}}},
            "output": {"type": "object", "properties": {"text": {"type": "string"}, "delivery": {"type": "object"}}}},
    eval="""
# Eval

```json
[
  {"id": "expands-numerals",
   "input": {"line": {"text": "It has 15% vitamin C"}, "voice": {"language": "en"}},
   "expect": {"contains_any": ["fifteen percent"], "not_contains": ["15%"]}},
  {"id": "keeps-directions-out-of-the-text",
   "input": {"line": {"text": "I love it", "emotion": "warm"}, "voice": {"language": "en"}},
   "expect": {"not_contains": ["(warmly)", "[warm]"]}},
  {"id": "passes-pronunciation-hints-through",
   "input": {"line": {"text": "Try Nuvei today", "pronunciation_hints": {"Nuvei": "noo-VAY"}}, "voice": {"language": "en"}},
   "expect": {"has_pronunciation_hints": true}}
]
```
"""),

"mmaudio-prompt": dict(
    name="MMAudio Prompt Compiler", status="active",
    description="Describe the sound a shot should have, as sources rather than as a mood.",
    supported_models=["mmaudio"], requires_skills=["sfx-planner", "ambience-planner"],
    body="""
Video-to-audio models respond to named sound sources and ignore atmosphere
words. "Tense atmosphere" produces nothing usable; "a refrigerator hum, distant
traffic through a closed window, a chair creaking" produces a room.

Write the sources you can point at in the picture, loudest first. If a hand
touches a surface, that contact makes a sound and the model will place it
correctly when told it exists.

Separate the layers:

- **Contact sounds** tied to visible action -- footsteps, a jar opening, fabric.
- **Room tone** -- what this space sounds like empty. Every interior has one,
  and its absence is why generated video sounds like a vacuum.
- **Distance** -- what is audible from outside the frame.

Never ask for dialogue or music here. Dialogue comes from TTS on its own track,
and music is placed deliberately on the timeline. Sound generated over speech
cannot be separated afterwards.

State the duration in the request and let the timeline own it. This model fills
a window; it does not get to choose one.
""",
    schema={"input": {"type": "object", "properties": {"shot": {"type": "object"}, "target_duration_samples": {"type": "integer"}}},
            "output": {"type": "object", "properties": {"prompt": {"type": "string"}}}},
    eval="""
# Eval

```json
[
  {"id": "names-sources-not-moods",
   "input": {"shot": {"description": "a woman opens a jar in a quiet kitchen"}, "target_duration_samples": 96000},
   "expect": {"contains_any": ["jar", "lid", "kitchen"], "not_contains": ["tense", "atmosphere", "mood"]}},
  {"id": "includes-room-tone",
   "input": {"shot": {"description": "an office interior"}, "target_duration_samples": 96000},
   "expect": {"has_room_tone_clause": true}},
  {"id": "never-requests-speech-or-music",
   "input": {"shot": {"description": "two people talking in a cafe"}, "target_duration_samples": 96000},
   "expect": {"not_contains": ["dialogue", "voice", "music", "song"]}}
]
```
"""),
}

write_all("prompt", SKILLS)
