# Eval

```json
[
  {"id": "translates-dolly",
   "input": {"camera": {"movement": "dolly in"}},
   "expect": {"contains_any": ["moves", "closer"], "not_contains": ["dolly"]}},
  {"id": "static-says-so-plainly",
   "input": {"camera": {"movement": "static"}},
   "expect": {"contains_any": ["does not move", "static frame", "still"]}},
  {"id": "refuses-stacked-movement",
   "input": {"camera": {"movement": "pan while pushing in and craning up"}},
   "expect": {"single_movement": true}}
]
```
