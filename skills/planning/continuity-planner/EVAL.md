# Eval

```json
[
  {"id": "records-dependencies-not-just-prose",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"writes_dependencies": true}},
  {"id": "holds-light-direction-in-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"fixes_light_direction": true}},
  {"id": "keeps-wardrobe-fixed-within-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "character_ids": ["c1"]}},
   "expect": {"fixes_wardrobe": true}}
]
```
