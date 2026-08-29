# Eval

```json
[
  {"id": "captions-repair-captions-only",
   "input": {"classification": "composition_fault", "findings": [{"code": "caption_mismatch"}]},
   "expect": {"scope": "caption"}},
  {"id": "mouth-only-repairs-lipsync",
   "input": {"classification": "local_artifact", "findings": [{"code": "lip_sync", "severity": "high"}]},
   "expect": {"scope": "lipsync"}},
  {"id": "entity-change-invalidates-dependents",
   "input": {"classification": "identity_fault", "entity_changed": true},
   "expect": {"scope": "dependent_shots"}},
  {"id": "never-selects-project-scope",
   "input": {"classification": "whole_shot_failure"},
   "expect": {"scope_not": "project"}},
  {"id": "refuses-when-the-budget-cannot-cover-it",
   "input": {"classification": "whole_shot_failure", "remaining_gpu_seconds": 5},
   "expect": {"scope": "none", "needs_review": true}}
]
```
