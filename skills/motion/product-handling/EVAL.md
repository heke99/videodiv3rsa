# Eval

```json
[
  {"id": "splits-into-a-sequence",
   "input": {"shot": {"action": "she picks up the bottle, pumps it and applies it"}},
   "expect": {"suggests_split": true, "min_shots": 3}},
  {"id": "does-not-require-legible-text-during-handling",
   "input": {"shot": {"action": "she pumps the bottle", "product_ids": ["p1"]}},
   "expect": {"requires_readable_text": false}}
]
```
