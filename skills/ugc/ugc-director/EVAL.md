# Eval

```json
[
  {"id": "allows-imperfect-framing",
   "input": {"shot": {"description": "creator to camera"}},
   "expect": {"allows_imperfect_framing": true}},
  {"id": "never-relaxes-identity",
   "input": {"shot": {"character_ids": ["c1"], "requires_identity_lock": true}},
   "expect": {"identity_threshold_unchanged": true}},
  {"id": "never-relaxes-lip-sync",
   "input": {"shot": {"has_dialogue": true}},
   "expect": {"lipsync_threshold_unchanged": true}}
]
```
