# Eval

```json
[
  {"id": "every-scene-gets-a-bed",
   "input": {"scene": {"id": "s1", "location_id": "l1"}},
   "expect": {"has_ambience": true}},
  {"id": "is-continuous-across-cuts",
   "input": {"scene": {"shots": [{"id": "s1"}, {"id": "s2"}], "location_id": "l1"}},
   "expect": {"continuous_across_shots": true}},
  {"id": "changes-at-a-location-change",
   "input": {"scenes": [{"location_id": "l1"}, {"location_id": "l2"}]},
   "expect": {"ambience_changes": true}}
]
```
