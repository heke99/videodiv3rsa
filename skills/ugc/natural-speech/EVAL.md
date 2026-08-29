# Eval

```json
[
  {"id": "uses-contractions",
   "input": {"line": "I have not seen results like this before"},
   "expect": {"contains_any": ["haven't", "I've"]}},
  {"id": "avoids-marketing-register",
   "input": {"line": "This revolutionary formula delivers unparalleled results"},
   "expect": {"not_contains": ["revolutionary", "unparalleled", "delivers"]}},
  {"id": "respects-word-budget",
   "input": {"target_duration_seconds": 30},
   "expect": {"max_words": 80}}
]
```
