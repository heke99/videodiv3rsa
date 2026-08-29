# Eval

```json
[
  {"id": "describes-effect-not-numbers",
   "input": {"shot": {"shot_type": "closeup"}},
   "expect": {"not_contains": ["mm", "35mm", "85mm"]}},
  {"id": "avoids-wide-on-product",
   "input": {"shot": {"shot_type": "product_hero", "requires_product_fidelity": true}},
   "expect": {"lens_not": "wide"}}
]
```
