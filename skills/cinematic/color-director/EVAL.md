# Eval

```json
[
  {"id": "holds-palette-across-shots",
   "input": {"shots": [{"id": "s1"}, {"id": "s2"}]},
   "expect": {"consistent_palette": true}},
  {"id": "protects-brand-colour",
   "input": {"shot": {"requires_product_fidelity": true}, "product": {"colors": ["#1B7F4B"]}},
   "expect": {"preserves_product_colour": true}}
]
```
