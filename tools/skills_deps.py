import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from write_skills import write_all

def ev(cases): return "# Eval\n\n```json\n" + cases + "\n```\n"

UGC = {
"creator-eye-contact": dict(
    name="Creator Eye Contact", status="active", modes=["UGC", "AVATAR"],
    description="Direct where a speaking subject looks, which decides whether a talking shot connects.",
    body="""
Gaze is the difference between a person addressing you and a person reading at
you, and it is the single strongest factor in whether avatar video feels alive.

Choose deliberately:
- **Down the lens** for direct address. Required for a hook, a claim, or a CTA.
- **Slightly off-lens** for reflection, or for lines the speaker is working out
  as they say them. Also useful for making a long take bearable.
- **Away and back** at a natural point -- looking away while thinking, returning
  on the point. This one small movement does more for realism than any amount of
  facial detail.

The failure to avoid is the fixed stare. A subject locked on the lens for the
whole shot reads as unsettling, because real people break contact constantly.

Beware the almost-eye-contact of someone watching their own preview: looking
slightly below the lens is a specific, recognisable wrongness. If the shot is
direct address, say the lens explicitly.
""",
    eval=ev("""[
  {"id": "direct-address-uses-the-lens",
   "input": {"line": {"text": "if you have tried these and they made you peel", "role": "hook"}},
   "expect": {"gaze": "lens"}},
  {"id": "breaks-contact-in-a-long-take",
   "input": {"shot": {"duration_frames": 240, "has_dialogue": true}},
   "expect": {"has_gaze_break": true}},
  {"id": "never-a-fixed-stare",
   "input": {"shot": {"duration_frames": 240, "has_dialogue": true}},
   "expect": {"gaze_not": "fixed"}}
]""")),
}

MOTION = {
"facial-expression": dict(
    name="Facial Expression", status="active",
    description="Give a face an expression that moves rather than a held pose.",
    body="""
A held expression is a mask, and generated video defaults to one because a
prompt naming an emotion gives no reason for it to change.

Describe expression as movement across the shot: where it starts, what changes
it, where it ends. "Neutral, softening as she recognises it" gives the model an
arc; "smiling" gives it a pose to hold for four seconds.

The specific parts that carry expression are the eyes and the mouth corners,
and they do not move together. A smile that reaches the eyes and one that does
not are entirely different signals, and generated faces default to the latter --
the mouth curves and the eyes stay flat, which reads as insincere.

Include blinks. Their absence is uncanny, and generated subjects frequently do
not blink at all.

Keep intensity low. Strong expressions overshoot badly and are rarely what the
material needs.
""",
    eval=ev("""[
  {"id": "expresses-an-arc",
   "input": {"shot": {"action": "she recognises what it does"}},
   "expect": {"has_arc": true}},
  {"id": "specifies-the-eyes-separately",
   "input": {"shot": {"action": "she smiles"}},
   "expect": {"mentions_eyes": true}},
  {"id": "includes-blinking",
   "input": {"shot": {"shot_type": "closeup", "duration_frames": 96}},
   "expect": {"has_blink_clause": true}}
]""")),
}

AUDIO = {
"lip-sync-planner": dict(
    name="Lip Sync Planner", status="active",
    description="Prepare the inputs a speech-driven shot needs to sync correctly.",
    body="""
Lip sync is decided before generation, by what the model is given.

The requirements:
- **Final audio, not a draft.** The line that will ship must be the line that
  drives the video, or every regeneration of the audio invalidates the picture.
- **Alignment computed and attached.** Word and phoneme timings let the repair
  path work later; without them a lip sync failure can be detected but not
  fixed.
- **The face large enough.** Below roughly a fifth of frame height there is not
  enough resolution for mouth detail, and sync will read as wrong however good
  the model is.
- **The mouth unobstructed.** A hand near the face, a microphone, hair across
  the mouth: all of these break sync and none are recoverable.

Plan the shot around these rather than fixing afterwards. A close enough,
unobstructed, correctly driven shot syncs; the repair path exists for when it
does not, and it is more expensive than getting it right.

Never let picture be generated before the audio it must match. That ordering
error is the most expensive one available here.
""",
    eval=ev("""[
  {"id": "requires-final-audio",
   "input": {"shot": {"has_dialogue": true}, "audio": {"is_draft": true}},
   "expect": {"blocked": true}},
  {"id": "requires-alignment",
   "input": {"shot": {"has_dialogue": true}, "audio": {"alignment_id": null}},
   "expect": {"blocked": true}},
  {"id": "flags-a-face-too-small",
   "input": {"shot": {"has_dialogue": true, "shot_type": "wide"}},
   "expect": {"flags_face_size": true}},
  {"id": "flags-an-obstructed-mouth",
   "input": {"shot": {"has_dialogue": true, "action": "she talks with her hand near her chin"}},
   "expect": {"flags_obstruction": true}}
]""")),

"pronunciation-planner": dict(
    name="Pronunciation Planner", status="active",
    description="Make sure names and brands are said correctly and identically every time.",
    body="""
A brand name mispronounced is the error a client notices before any other, and
one mispronounced differently between shots is worse still.

Collect, before any speech is generated:
- the brand name and every product name
- personal and place names
- initialisms, and whether each is spelled out or said as a word
- loanwords and anything whose spelling does not predict its sound
- ambiguous English words where the sense decides the sound -- read, live, lead

Give each a respelling the speech model can act on, and store it on the voice
profile so every line in the project inherits it. A hint applied per line will
eventually be forgotten on one, and that one will ship.

Check numbers too. Years, prices and percentages have several valid readings,
and consistency matters more than which one is chosen.

Where a pronunciation is genuinely uncertain, ask rather than guessing. It is a
question a person can answer in seconds and a model cannot answer at all.
""",
    eval=ev("""[
  {"id": "collects-brand-names",
   "input": {"brief": {"product": {"name": "Nuvei"}}},
   "expect": {"has_hint_for": "Nuvei"}},
  {"id": "stores-hints-on-the-voice-profile",
   "input": {"brief": {"product": {"name": "Nuvei"}}},
   "expect": {"stored_on_voice_profile": true}},
  {"id": "resolves-ambiguous-words",
   "input": {"line": {"text": "she read the label"}},
   "expect": {"has_hint_for": "read"}}
]""")),
}

write_all("ugc", UGC)
write_all("motion", MOTION)
write_all("audio", AUDIO)
