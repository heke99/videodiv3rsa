# Eval

```json
[
  {"id": "quality-retry-changes-seed",
   "input": {"reason": "quality_failure", "previous_seed": 12345},
   "expect": {"seed_differs_from_previous": true}},
  {"id": "lipsync-repair-keeps-seed",
   "input": {"reason": "lipsync_repair", "previous_seed": 12345},
   "expect": {"seed": 12345}}
]
```
