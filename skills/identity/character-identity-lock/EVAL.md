# Eval

```json
[
  {"id": "prefers-i2v-when-face-is-visible",
   "input": {"shot": {"character_ids": ["c1"], "shot_type": "closeup"}},
   "expect": {"generation_kind": "image_to_video"}},
  {"id": "uses-canonical-description-verbatim",
   "input": {"shot": {"character_ids": ["c1"], "preferred_generation_kind": "text_to_video"},
             "character": {"id": "c1", "canonical": "shoulder-length dark brown hair, centre parted"}},
   "expect": {"contains_all": ["shoulder-length dark brown hair"]}},
  {"id": "never-restates-appearance-in-i2v",
   "input": {"shot": {"character_ids": ["c1"], "preferred_generation_kind": "image_to_video"},
             "character": {"id": "c1", "canonical": "dark brown hair"}},
   "expect": {"not_contains": ["dark brown hair"]}}
]
```
