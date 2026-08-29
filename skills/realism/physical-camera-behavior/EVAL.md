# Eval

```json
[
  {"id": "adds-motion-blur-to-fast-motion",
   "input": {"shot": {"action": "she turns quickly", "motion_complexity": 0.8}},
   "expect": {"has_motion_blur_clause": true}},
  {"id": "keeps-artifacts-sparse",
   "input": {"shot": {"description": "a static portrait"}},
   "expect": {"max_artifacts": 2}}
]
```
