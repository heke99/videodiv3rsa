# Eval

```json
[
  {"id": "holds-the-axis",
   "input": {"scene": {"shots": [{"id": "s1", "camera_side": "left"}, {"id": "s2", "camera_side": "right"}]}},
   "expect": {"flags_axis_crossing": true}},
  {"id": "limits-equal-weight-figures",
   "input": {"shot": {"character_ids": ["c1", "c2", "c3", "c4"]}},
   "expect": {"has_dominant_subject": true}}
]
```
