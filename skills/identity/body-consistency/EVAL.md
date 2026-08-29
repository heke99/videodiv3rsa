# Eval

```json
[
  {"id": "anchors-height-to-the-environment",
   "input": {"shot": {"character_ids": ["c1"], "location_id": "l1"}},
   "expect": {"has_height_anchor": true}},
  {"id": "carries-posture-from-the-bible",
   "input": {"shot": {"character_ids": ["c1"]}, "character": {"id": "c1", "posture": "weight on left hip"}},
   "expect": {"contains_any": ["weight on left hip"]}}
]
```
