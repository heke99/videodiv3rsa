# Eval

```json
[
  {"id": "rebuilds-from-alignment",
   "input": {"finding": {"code": "caption_mismatch"}},
   "expect": {"action": "rebuild_from_alignment"}},
  {"id": "rebuilds-even-when-text-is-unchanged",
   "input": {"dialogue_regenerated": true, "text_changed": false},
   "expect": {"action": "rebuild_from_alignment"}},
  {"id": "rechecks-safe-area",
   "input": {"finding": {"code": "caption_mismatch"}},
   "expect": {"rechecks_safe_area": true}}
]
```
