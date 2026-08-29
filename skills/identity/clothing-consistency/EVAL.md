# Eval

```json
[
  {"id": "specifies-closure-state",
   "input": {"shot": {"character_ids": ["c1"]}, "character": {"id": "c1", "clothes": "denim jacket"}},
   "expect": {"has_closure_state": true}},
  {"id": "holds-identical-within-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"identical_wardrobe": true}}
]
```
