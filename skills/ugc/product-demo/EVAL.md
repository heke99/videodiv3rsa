# Eval

```json
[
  {"id": "includes-the-mechanism",
   "input": {"brief": {"product": {"name": "serum", "key_features": ["absorbs fast"]}}},
   "expect": {"has_mechanism_shot": true}},
  {"id": "does-not-cut-away-at-use",
   "input": {"plan": {"shots": [{"id": "s1", "action": "she applies it"}]}},
   "expect": {"holds_through_use": true}}
]
```
