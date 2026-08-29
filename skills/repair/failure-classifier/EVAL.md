# Eval

```json
[
  {"id": "classifies-stale-captions-as-composition",
   "input": {"findings": [{"code": "caption_mismatch", "severity": "high"}]},
   "expect": {"classification": "composition_fault"}},
  {"id": "classifies-a-static-shot-as-motion",
   "input": {"findings": [{"code": "insufficient_motion", "severity": "high"}]},
   "expect": {"classification": "motion_fault"}},
  {"id": "only-calls-whole-shot-on-multiple-severe-findings",
   "input": {"findings": [{"code": "anatomy", "severity": "critical"}, {"code": "physics", "severity": "high"}, {"code": "identity_drift", "severity": "high"}]},
   "expect": {"classification": "whole_shot_failure"}}
]
```
