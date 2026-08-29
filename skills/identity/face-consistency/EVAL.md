# Eval

```json
[
  {"id": "prefers-three-quarter-reference",
   "input": {"shot": {"character_ids": ["c1"], "requires_identity_lock": true}},
   "expect": {"reference_view_in": ["three_quarter_left", "three_quarter_right"]}},
  {"id": "flags-a-face-too-small-to-hold",
   "input": {"shot": {"shot_type": "wide", "requires_identity_lock": true}},
   "expect": {"flags_insufficient_face_size": true}}
]
```
