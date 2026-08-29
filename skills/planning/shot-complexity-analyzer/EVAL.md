# Eval

```json
[
  {"id": "passes-a-simple-shot",
   "input": {"shot": {"action": "she looks at the camera", "character_ids": ["c1"], "duration_frames": 72}},
   "expect": {"should_split": false}},
  {"id": "splits-walking-plus-handling-plus-camera-move",
   "input": {"shot": {"action": "she walks in holding the bottle while the camera pushes in",
                      "character_ids": ["c1"], "product_ids": ["p1"], "duration_frames": 200}},
   "expect": {"should_split": true, "min_shots": 2}},
  {"id": "recommends-a-concrete-split",
   "input": {"shot": {"action": "he opens the box, takes it out and holds it up"}},
   "expect": {"has_split_recommendation": true}}
]
```
