# Eval

```json
[
  {"id": "talking-head-holds-tight",
   "input": {"shot": {"requires_identity_lock": true, "motion_complexity": 0.1}},
   "expect": {"strength_min": 0.8}},
  {"id": "walking-character-loosens",
   "input": {"shot": {"requires_identity_lock": true, "motion_complexity": 0.8}},
   "expect": {"strength_max": 0.8}},
  {"id": "product-text-holds-tightest",
   "input": {"shot": {"requires_product_fidelity": true}},
   "expect": {"strength_min": 0.9}}
]
```
