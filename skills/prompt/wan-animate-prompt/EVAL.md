# Eval

```json
[
  {"id": "describes-manner-not-appearance",
   "input": {"shot": {"action": "she reaches for the shelf"}, "reference": {"asset_id": "r1"}},
   "expect": {"contains_any": ["reaches"], "not_contains": ["wearing", "hair"]}},
  {"id": "refuses-stacked-actions",
   "input": {"shot": {"action": "he stands, walks over and sits down"}, "reference": {"asset_id": "r1"}},
   "expect": {"single_action": true}}
]
```
