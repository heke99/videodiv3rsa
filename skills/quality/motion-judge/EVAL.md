# Eval

```json
[
  {"id": "flags-a-static-shot-that-should-move",
   "input": {"measured_motion": 0.02, "planned_motion_complexity": 0.7},
   "expect": {"passed": false, "finding_codes_contain": "insufficient_motion"}},
  {"id": "flags-incoherent-excess-motion",
   "input": {"measured_motion": 0.95, "planned_motion_complexity": 0.2},
   "expect": {"passed": false}},
  {"id": "passes-a-match",
   "input": {"measured_motion": 0.55, "planned_motion_complexity": 0.5},
   "expect": {"passed": true}}
]
```
