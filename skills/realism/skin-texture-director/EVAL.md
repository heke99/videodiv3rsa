# Eval

```json
[
  {"id": "detail-scales-with-shot-size",
   "input": {"shot": {"shot_type": "wide", "character_ids": ["c1"]}},
   "expect": {"not_contains": ["pores"]}},
  {"id": "closeup-gets-pore-detail",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"contains_any": ["pores", "fine lines"]}},
  {"id": "never-asks-for-flawless",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"not_contains": ["flawless", "poreless", "perfect skin"]}}
]
```
