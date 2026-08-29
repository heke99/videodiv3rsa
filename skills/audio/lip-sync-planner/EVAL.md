# Eval

```json
[
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
]
```
