# Eval

```json
[
  {"id": "holds-light-direction-across-a-scene",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"consistent_light_direction": true}},
  {"id": "carries-persistent-objects",
   "input": {"shot": {"location_id": "l1"}, "location": {"id": "l1", "persistent_objects": ["a vase of dried flowers"]}},
   "expect": {"contains_any": ["vase"]}}
]
```
