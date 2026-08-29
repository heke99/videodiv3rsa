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
