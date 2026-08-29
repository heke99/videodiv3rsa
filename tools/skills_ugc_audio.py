import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def ev(cases): return "# Eval\n\n```json\n" + cases + "\n```\n"

UGC = {
"ugc-director": dict(
    name="UGC Director", status="active", modes=["UGC"],
    description="Coordinate the choices that make content read as a real creator rather than an ad.",
    requires_skills=["creator-persona", "mobile-camera", "natural-speech", "informal-pacing"],
    body="""
UGC has one hard requirement that the rest of the system inverts: it must look
less produced, on purpose. It also has a floor it may never go below.

Deliberately imperfect:
- framing slightly off, adjusted mid-shot
- lighting from whatever is actually in the room
- speech with hesitations, restarts and uneven pace
- the creator glancing away and back
- backgrounds that are lived-in rather than styled

Never acceptable, regardless of the aesthetic:
- identity drift
- bad lip sync
- the wrong product, or a garbled label
- broken hands
- physics that does not work

That distinction is the whole skill. Imperfection is a style choice; those five
are defects, and a viewer reads them as fake rather than as authentic. UGC does
not lower the quality bar, it moves it: less polish, same correctness.

The other trap is over-correction. Content that performs unpolish -- shaky cam
as an effect, scripted stumbles -- reads worse than something merely
competent, because it is visibly trying. When in doubt, be plain rather than
performatively rough.
""",
    eval=ev("""[
  {"id": "allows-imperfect-framing",
   "input": {"shot": {"description": "creator to camera"}},
   "expect": {"allows_imperfect_framing": true}},
  {"id": "never-relaxes-identity",
   "input": {"shot": {"character_ids": ["c1"], "requires_identity_lock": true}},
   "expect": {"identity_threshold_unchanged": true}},
  {"id": "never-relaxes-lip-sync",
   "input": {"shot": {"has_dialogue": true}},
   "expect": {"lipsync_threshold_unchanged": true}}
]""")),

"creator-persona": dict(
    name="Creator Persona", status="active", modes=["UGC"],
    description="Define who is speaking, specifically enough that the script and delivery follow from it.",
    body="""
A persona is not a demographic. "Woman, 28, interested in skincare" produces
generic copy. What produces a voice is a specific relationship to the product.

Define:
- **What they were doing before this product.** Someone who tried three
  retinols and quit talks differently from someone new to the category.
- **What they were sceptical about**, and whether they still are.
- **How they talk** -- fast and enthusiastic, dry and understated, careful.
- **What they would never say.** A person who has been burned by marketing
  claims does not use marketing claims.

That last one does most of the work. The constraint on vocabulary is what stops
the script sliding back into advertising language.

Keep the persona consistent with the voice profile and the character reference.
A dry, understated persona delivered in an up-tempo enthusiastic voice reads as
two different people.
""",
    eval=ev("""[
  {"id": "defines-prior-relationship",
   "input": {"brief": {"audience": "women 25-40", "product": {"name": "serum"}}},
   "expect": {"has_prior_relationship": true}},
  {"id": "defines-forbidden-vocabulary",
   "input": {"brief": {"audience": "sceptical buyers"}},
   "expect": {"has_forbidden_phrases": true}}
]""")),

"mobile-camera": dict(
    name="Mobile Camera", status="active", modes=["UGC"],
    description="Reproduce how a phone actually renders a scene.",
    body="""
Phone footage has a specific signature, and getting it right does more for
authenticity than any amount of deliberate shakiness.

- **Wide lens, close subject.** Phones are wide by default, so a selfie has
  mild edge distortion and a face slightly larger than a normal lens would give.
- **Deep focus.** Almost everything is sharp. Heavy background blur reads as a
  camera, not a phone, unless portrait mode is intended -- and portrait mode has
  its own tell, a slightly wrong cutout at the hair.
- **Aggressive auto-exposure.** Phones expose for the face and blow out
  windows. A perfectly balanced interior with a correctly exposed window outside
  is a cinema camera.
- **Overhead or window light**, whatever is in the room, not a lighting setup.
- **Handheld, but stabilised.** Modern phones remove most shake and leave a
  slight floating quality. Violent camera shake is a decade out of date.

Get exposure and depth of field right and the shot reads as a phone even when
perfectly steady. Get them wrong and no amount of shake will save it.
""",
    eval=ev("""[
  {"id": "uses-deep-focus",
   "input": {"shot": {"description": "creator selfie"}},
   "expect": {"depth_of_field": "deep"}},
  {"id": "blows-out-the-window",
   "input": {"shot": {"description": "creator in front of a window"}},
   "expect": {"has_blown_highlights": true}},
  {"id": "does-not-ask-for-violent-shake",
   "input": {"shot": {"description": "handheld selfie"}},
   "expect": {"not_contains": ["shaky", "violent shake"]}}
]""")),

"natural-speech": dict(
    name="Natural Speech", status="active", modes=["UGC"],
    description="Write lines that sound spoken rather than written.",
    body="""
The fastest way to make UGC read as an ad is to write copy and have someone say
it. Spoken language has properties written copy does not.

- **Contractions, always.** "I have not" is written; "I haven't" is spoken.
- **Sentences that start with and, but, so.** Editors remove these; speakers use
  them constantly.
- **Self-interruption.** "It's -- okay so the texture is the thing." One of
  these per script, not more.
- **Concrete over abstract.** "It sinks in before I finish getting dressed"
  rather than "it absorbs quickly".
- **Understatement.** "It's pretty good, actually" is more persuasive from a
  real person than "it's amazing".

Read it aloud mentally. Anything you would not say to a friend gets cut.

Length matters: about 2.5 words per second in conversational delivery, so
thirty seconds is roughly seventy words. Overwritten UGC is the most common
reason a video feels rushed and salesy.
""",
    eval=ev("""[
  {"id": "uses-contractions",
   "input": {"line": "I have not seen results like this before"},
   "expect": {"contains_any": ["haven't", "I've"]}},
  {"id": "avoids-marketing-register",
   "input": {"line": "This revolutionary formula delivers unparalleled results"},
   "expect": {"not_contains": ["revolutionary", "unparalleled", "delivers"]}},
  {"id": "respects-word-budget",
   "input": {"target_duration_seconds": 30},
   "expect": {"max_words": 80}}
]""")),

"informal-pacing": dict(
    name="Informal Pacing", status="active", modes=["UGC"],
    description="Vary rhythm so delivery sounds like thinking rather than reciting.",
    body="""
Even pacing is the tell of a read script. Real speech accelerates through the
familiar and slows at the point that matters.

Build the rhythm into the timing:

- **Fast through setup.** The context the speaker has said many times comes out
  quickly.
- **Slow at the turn.** The moment the claim lands gets space around it.
- **A real pause before the point**, not after it. Pausing after a claim is a
  presenter habit; pausing before it is how people actually build to something.
- **Trail off at the end** rather than landing hard. Hard endings sound
  scripted.

Express these as explicit pause values on the dialogue lines so the alignment
step honours them and the video is cut to them, rather than hoping the speech
model infers the intent.

Two pauses in a thirty-second script is plenty. More becomes halting.
""",
    eval=ev("""[
  {"id": "places-a-pause-before-the-claim",
   "input": {"script": {"lines": [{"text": "I tried it for two weeks"}, {"text": "and my skin actually cleared up"}]}},
   "expect": {"pause_before_claim": true}},
  {"id": "keeps-pauses-few",
   "input": {"script": {"target_duration_seconds": 30}},
   "expect": {"max_pauses": 3}}
]""")),

"hook-generator": dict(
    name="Hook Generator", status="active", modes=["UGC"],
    description="Write an opening that earns the next two seconds.",
    body="""
The hook has about two seconds. It must give a specific reason to keep watching,
and almost every default hook fails to.

What does not work: a greeting, the brand name, a question the viewer has no
stake in, or "let me tell you about".

What works:
- **A stated tension.** "I gave up on retinol twice before this."
- **A result stated before the method.** "My skin cleared up and I only changed
  one thing."
- **A specific objection named.** "If you've tried these and they made you peel,
  this is different."
- **An admission.** "I did not expect this to work."

Specificity beats intensity. "I gave up on retinol twice" is stronger than
"this changed my life" because it is a fact rather than a claim.

Do not open on the product. A viewer who sees a product in the first second
knows it is an ad and leaves. The product enters after the tension is
established.
""",
    eval=ev("""[
  {"id": "does-not-open-on-the-product",
   "input": {"brief": {"product": {"name": "NOVA serum"}}},
   "expect": {"first_line_not_contains": ["NOVA"]}},
  {"id": "avoids-greeting-openers",
   "input": {"brief": {"platform": "tiktok"}},
   "expect": {"not_contains": ["hey guys", "hi everyone", "what's up"]}},
  {"id": "is-specific",
   "input": {"brief": {"problem": "retinol irritation"}},
   "expect": {"has_specific_detail": true}}
]""")),

"product-demo": dict(
    name="Product Demo", status="active", modes=["UGC", "PRODUCT"],
    description="Show the product doing the thing, in the order a viewer needs to see it.",
    requires_skills=["product-handling"],
    body="""
A demo is persuasive when the viewer can see the mechanism. Most fail because
they show the product existing rather than working.

Order that works:
1. **The problem state**, briefly and visibly.
2. **The product in use**, close enough that the action is unambiguous.
3. **The immediate result**, in the same setting so the comparison is fair.

Show the texture, the mechanism, the thing that is physically happening. A pump
dispensing, a cream absorbing, a surface changing. Those are the shots people
rewatch.

Do not cut away at the moment of use. That is the shot the whole video exists
for, and cutting from it signals there was nothing to see.

Keep claims to what the footage shows. A demo that shows one thing while the
voiceover claims another is worse than either alone.
""",
    eval=ev("""[
  {"id": "includes-the-mechanism",
   "input": {"brief": {"product": {"name": "serum", "key_features": ["absorbs fast"]}}},
   "expect": {"has_mechanism_shot": true}},
  {"id": "does-not-cut-away-at-use",
   "input": {"plan": {"shots": [{"id": "s1", "action": "she applies it"}]}},
   "expect": {"holds_through_use": true}}
]""")),

"cta-generator": dict(
    name="CTA Generator", status="active", modes=["UGC"],
    description="Close without breaking the voice the rest of the video established.",
    body="""
A call to action that switches register undoes the video. Thirty seconds of a
real person followed by two seconds of advertising copy tells the viewer the
whole thing was an ad.

Keep the CTA in the speaker's voice. "Link's in my bio if you want to try it" is
a person; "Click the link below to transform your skin today" is a brand.

Make it low-pressure. Real recommendations are casual, and casual converts
better in this format because it does not trigger the ad response.

Reference the specific thing they just saw rather than a generic benefit. "If
the peeling thing is your problem too" beats "for beautiful skin".

Never stack CTAs. One action, stated once.

It is also legitimate to end without one. A video that simply ends after the
result is often stronger than one that asks, and the platform's own affordances
do the rest.
""",
    eval=ev("""[
  {"id": "stays-in-voice",
   "input": {"script": {"tone": ["casual", "dry"]}},
   "expect": {"not_contains": ["transform", "today only", "click the link below"]}},
  {"id": "single-action",
   "input": {"brief": {"cta": "follow, like and visit the site"}},
   "expect": {"cta_count": 1}}
]""")),

"selfie-framing": dict(
    name="Selfie Framing", status="active", modes=["UGC", "AVATAR"],
    description="Frame a front-facing shot the way a person actually holds a phone.",
    requires_skills=["mobile-camera", "framing-director"],
    body="""
Self-shot framing has a geometry people recognise immediately.

- **Slightly above eye level, angled down a few degrees.** An arm holds the
  phone up, not out. Below eye level reads as a security camera and is deeply
  unflattering.
- **Close.** Head and shoulders, sometimes head only. Arm's length is the
  constraint, and it is closer than a camera operator would choose.
- **Slightly off-centre**, because arms are not tripods.
- **Fixed distance** through the shot. A selfie that dollies smoothly is not a
  selfie.

The subject looks at the lens, not at their own image on screen. The difference
is small and readable: looking at the preview means looking slightly below the
lens, which is exactly the not-quite-eye-contact that makes avatar video feel
wrong.

Keep the vertical framing high in 9:16 so captions do not cover the mouth.
""",
    eval=ev("""[
  {"id": "puts-camera-above-eye-level",
   "input": {"shot": {"shot_type": "selfie"}},
   "expect": {"camera_height": "above_eye_level"}},
  {"id": "looks-at-the-lens",
   "input": {"shot": {"shot_type": "selfie", "has_dialogue": true}},
   "expect": {"gaze": "lens"}},
  {"id": "no-smooth-camera-movement",
   "input": {"shot": {"shot_type": "selfie"}},
   "expect": {"movement": "static"}}
]""")),

"ugc-authenticity-judge": dict(
    name="UGC Authenticity Judge", status="active", category_note="quality", modes=["UGC"],
    description="Judge whether content reads as a real creator, without excusing actual defects.",
    body="""
This judge answers one question: would a viewer scrolling past believe a person
made this?

Score down for signs of production:
- lighting that is too even or too flattering to be a room
- framing that is too well composed
- speech that is too fluent and evenly paced
- a background that is too styled
- gestures that are too regular

Score down separately, and harder, for defects:
- identity drift, bad lip sync, wrong product, broken hands, impossible physics

Keep the two axes apart in the finding codes. A shot that is too polished needs
a different fix from a shot with a broken hand, and collapsing them into one
score means the repair planner cannot tell which it is.

Do not reward roughness on its own. A badly framed, badly lit shot with no
defects is not authentic, it is bad. The target is a competent person filming
casually, not an incompetent one.
""",
    eval=ev("""[
  {"id": "flags-overproduction",
   "input": {"metrics": {"lighting_evenness": 0.95, "framing_symmetry": 0.95}},
   "expect": {"finding_codes_contain": "overproduced"}},
  {"id": "flags-defects-separately",
   "input": {"metrics": {"identity_drift": 0.4}},
   "expect": {"finding_codes_contain": "identity_drift"}},
  {"id": "does-not-reward-mere-roughness",
   "input": {"metrics": {"lighting_evenness": 0.2, "framing_symmetry": 0.2, "exposure_error": 0.8}},
   "expect": {"score_max": 0.6}}
]""")),
}

AUDIO = {
"speech-director": dict(
    name="Speech Director", status="active",
    description="Decide how a line should be delivered before it is generated.",
    body="""
Delivery is a decision, not a default. A line generated without one comes back
in the model's neutral register, which is the flat, slightly bright read that
marks synthetic speech.

For each line decide: energy relative to the surrounding lines, where the
emphasis falls, and whether it rises or settles at the end.

Emphasis is the most useful and most neglected. "I did not expect that to work"
means four different things depending on which word carries. State the word.

Match energy to content. Contradiction between what is said and how it is said
is audible and reads as insincere, which in a testimonial is fatal.

Let energy vary across a script. Uniform delivery is the strongest cue that
something was machine-read, and it is entirely avoidable.
""",
    eval=ev("""[
  {"id": "names-the-emphasised-word",
   "input": {"line": {"text": "I did not expect that to work"}},
   "expect": {"has_emphasis": true}},
  {"id": "varies-energy-across-a-script",
   "input": {"script": {"lines": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}},
   "expect": {"energy_varies": true}}
]""")),

"dialogue-timing": dict(
    name="Dialogue Timing", status="active",
    description="Fit speech to picture without speeding either up.",
    body="""
Speech and picture are produced separately and must be reconciled. There is a
right order to try the fixes.

1. **Extend the shot.** Frames are cheap and the audio is already correct.
2. **Cut words.** Almost every script is longer than it needs to be, and cutting
   improves it independently.
3. **Adjust the pause structure.** Tightening pauses recovers real time without
   touching delivery.
4. **Change the speech rate**, slightly, and only as a last resort.

Never do the fourth first. Speeding up speech to fit a planned duration is
instantly audible and is the most common way generated dialogue betrays itself.

Extending is nearly always right, because the plan's duration was a guess and
the audio is a measurement. The timeline already implements this: a shot whose
dialogue overruns is extended rather than clipped.

Leave a beat at the end of a line before the cut. Cutting on the final
consonant feels rushed even when it is technically correct.
""",
    eval=ev("""[
  {"id": "extends-before-compressing",
   "input": {"shot": {"duration_frames": 48}, "dialogue": {"length_samples": 120000}},
   "expect": {"action": "extend_shot"}},
  {"id": "never-compresses-first",
   "input": {"shot": {"duration_frames": 48}, "dialogue": {"length_samples": 120000}},
   "expect": {"action_not": "increase_speech_rate"}},
  {"id": "leaves-a-tail",
   "input": {"shot": {"duration_frames": 96}, "dialogue": {"length_samples": 96000}},
   "expect": {"has_tail_frames": true}}
]""")),

"pause-planner": dict(
    name="Pause Planner", status="active",
    description="Place silence where it carries meaning.",
    requires_skills=["dialogue-timing"],
    body="""
Silence is content. Generated speech has too little of it, which is part of why
it sounds relentless.

Place pauses:
- **Before** the point, to give it weight
- **After** a question, if one is asked
- **At a change of subject**, longer than a comma's worth
- **Where a person would breathe** -- roughly every fifteen to twenty words

Give them real durations. A meaningful pause is 300 to 600 milliseconds; a beat
before something important is 600 to 1000. Below about 200 milliseconds it
reads as a stumble rather than a choice.

Express pauses as explicit sample values on the dialogue line so the alignment
and the cut both honour them, instead of hoping the speech model produces them.

Do not pause on every comma. Over-pausing sounds like reading, which is the
thing being avoided.
""",
    eval=ev("""[
  {"id": "gives-pauses-real-durations",
   "input": {"line": {"text": "I did not expect it to work. But it did."}},
   "expect": {"min_pause_ms": 200}},
  {"id": "breathes-on-long-lines",
   "input": {"line": {"text": "I had tried three different products over about six months and none of them made any difference at all to the texture"}},
   "expect": {"has_breath_pause": true}}
]""")),

"emotion-director": dict(
    name="Emotion Director", status="active",
    description="Give a line an emotional arc rather than a label.",
    requires_skills=["speech-director"],
    body="""
A single emotion label applied to a whole line produces a performance held at
one level, which is what makes generated speech sound like a mask.

Give it a shape instead: where it starts, where it turns, where it ends.
"Sceptical at the start, softening on the second clause" is directable;
"positive" is not.

Keep it small. Real speech in this register moves through a narrow emotional
range, and generated speech asked for strong emotion overshoots badly. Understated
almost always outperforms.

Match the arc to the face if the shot is speech-driven, because the video model
receives the audio and will follow it. An arc in the voice with a fixed
expression is a mismatch a viewer notices.

For testimonials specifically, the arc that works is scepticism to quiet
surprise. Enthusiasm from the first word reads as paid.
""",
    eval=ev("""[
  {"id": "produces-an-arc",
   "input": {"line": {"text": "honestly I did not think it would do anything", "emotion": "sceptical"}},
   "expect": {"has_arc": true}},
  {"id": "keeps-the-range-narrow",
   "input": {"line": {"text": "it worked", "emotion": "ecstatic"}},
   "expect": {"intensity_max": 0.7}}
]""")),

"ambience-planner": dict(
    name="Ambience Planner", status="active",
    description="Give every scene a room tone so it does not sound like a vacuum.",
    body="""
Silence between lines is the loudest sign that audio was assembled rather than
recorded. Real spaces are never silent.

Every location gets a continuous bed, chosen from what the space would actually
contain: a room hum, distant traffic through glass, air movement, a refrigerator,
birds outside.

Keep it low. Ambience works below conscious perception; if the viewer notices
it, it is too loud. It should be audible only when it stops.

Keep it continuous across cuts within a scene. Ambience that changes at every
cut tells the viewer these shots were assembled, which is exactly what it exists
to conceal.

Change it deliberately at a location change, and let the change be audible.
That transition is one of the strongest signals that the story has moved.
""",
    eval=ev("""[
  {"id": "every-scene-gets-a-bed",
   "input": {"scene": {"id": "s1", "location_id": "l1"}},
   "expect": {"has_ambience": true}},
  {"id": "is-continuous-across-cuts",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"continuous_across_shots": true}},
  {"id": "changes-at-a-location-change",
   "input": {"scenes": [{"location_id": "l1"}, {"location_id": "l2"}]},
   "expect": {"ambience_changes": true}}
]""")),

"sfx-planner": dict(
    name="SFX Planner", status="active",
    description="Place the specific sounds the picture implies.",
    body="""
Every visible contact makes a sound, and its absence is felt even when the
viewer cannot name what is missing. A jar opening in silence looks wrong.

Work through the shot and list contacts: footsteps, a lid, fabric, a cap, a set
down, a door.

Place them on the exact frame of contact. A footstep landing two frames late is
perceptible, and a sound placed early is worse than one placed late.

Do not fill everything. A soundtrack with an effect on every movement sounds
like a cartoon. Choose the ones the frame draws attention to and let the rest
sit in the ambience.

Match scale to the picture. A small jar makes a small sound; the generic
oversized sound library effect is one of the most common ways a piece stops
sounding real.
""",
    eval=ev("""[
  {"id": "places-effects-on-the-contact-frame",
   "input": {"shot": {"action": "she sets the jar down", "contact_frame": 34}},
   "expect": {"effect_frame": 34}},
  {"id": "does-not-fill-every-movement",
   "input": {"shot": {"action": "she walks in, sits, picks up a cup, drinks, sets it down"}},
   "expect": {"max_effects": 4}}
]""")),

"audio-ducking": dict(
    name="Audio Ducking", status="active",
    description="Keep speech intelligible without the music pumping.",
    body="""
Dialogue must always be the clearest element. Music under speech competes for
the same frequency range, and the fix is attenuation with the right shape.

Around 9 dB of attenuation is right for most material. Less and speech still
fights the bed; much more and the dip becomes an audible event of its own.

Start the duck slightly before the speech, roughly 120 milliseconds, so the
space is already open when the first word lands. Recover slowly, around 400
milliseconds, because a fast recovery is the pumping artifact.

Merge closely spaced lines into one duck. Music that lifts between every
sentence is far more distracting than music held down through a passage.

Duck music only. Ambience is already below speech and ducking it creates an
audible hole where the room disappears.
""",
    eval=ev("""[
  {"id": "attenuates-by-about-9db",
   "input": {"music": {"gain_db": -6}, "speech": [{"start_sample": 48000, "end_sample": 96000}]},
   "expect": {"attenuation_db_range": [-12, -6]}},
  {"id": "merges-close-lines",
   "input": {"speech": [{"start_sample": 0, "end_sample": 48000}, {"start_sample": 50000, "end_sample": 96000}]},
   "expect": {"duck_count": 1}},
  {"id": "does-not-duck-ambience",
   "input": {"beds": [{"kind": "AMBIENCE"}], "speech": [{"start_sample": 0, "end_sample": 48000}]},
   "expect": {"ducked_kinds_exclude": "AMBIENCE"}}
]""")),

"loudness-check": dict(
    name="Loudness Check", status="active",
    description="Verify the final mix meets its delivery target by measurement.",
    body="""
Loudness is not a matter of taste; each platform has a target and normalises
against it. Delivering louder than the target does not make the video louder,
it makes the platform turn it down, and the dynamics are lost for nothing.

Measure integrated loudness, true peak and range on the final render, and
compare against the profile: social and YouTube at -14 LUFS, broadcast at -23,
cinema at -27.

Tolerance is about 1 LU. Beyond that, re-normalise rather than adjusting by ear.

True peak matters separately. Above -1 dBTP, lossy encoding on the platform
will clip audibly even though the file itself does not.

A loudness range near zero means the mix is over-compressed and will sound
lifeless, which is a defect a single integrated number hides.
""",
    eval=ev("""[
  {"id": "checks-against-the-profile",
   "input": {"measured_lufs": -14.2, "profile": "social"},
   "expect": {"passed": true}},
  {"id": "fails-when-too-loud",
   "input": {"measured_lufs": -9.0, "profile": "social"},
   "expect": {"passed": false}},
  {"id": "fails-on-true-peak",
   "input": {"measured_lufs": -14.0, "true_peak_dbtp": 0.3, "profile": "social"},
   "expect": {"passed": false}},
  {"id": "flags-an-over-compressed-mix",
   "input": {"measured_lufs": -14.0, "lra": 0.5, "profile": "social"},
   "expect": {"finding_codes_contain": "over_compressed"}}
]""")),
}

write_all("ugc", UGC)
write_all("audio", AUDIO)
