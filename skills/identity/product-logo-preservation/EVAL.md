# Eval

```json
[
  {"id": "requires-flat-framing",
   "input": {"shot": {"product_ids": ["p1"], "requires_product_fidelity": true}},
   "expect": {"has_flat_framing": true}},
  {"id": "turns-the-logo-away-when-conditions-are-poor",
   "input": {"shot": {"product_ids": ["p1"], "duration_frames": 240, "motion_complexity": 0.9}},
   "expect": {"hides_logo": true}}
]
```
