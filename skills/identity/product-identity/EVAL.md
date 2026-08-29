# Eval

```json
[
  {"id": "requires-a-keyframe",
   "input": {"shot": {"requires_product_fidelity": true}},
   "expect": {"generation_kind": "image_to_video"}},
  {"id": "specifies-material",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "material": "frosted glass"}},
   "expect": {"contains_any": ["frosted glass"]}},
  {"id": "colour-by-reference-not-by-name",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "colors": ["#1B7F4B"]}},
   "expect": {"uses_reference_colour": true}}
]
```
