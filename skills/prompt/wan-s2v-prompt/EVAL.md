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
