# Eval

```json
[
  {"id": "adds-motion-language-for-a-static-shot",
   "input": {"finding": {"code": "insufficient_motion"}},
   "expect": {"prompt_change": "add_motion_language"}},
  {"id": "stops-describing-appearance-on-identity-drift",
   "input": {"finding": {"code": "identity_drift"}, "generation_kind": "image_to_video"},
   "expect": {"prompt_change": "remove_appearance_description"}},
  {"id": "changes-one-thing",
   "input": {"findings": [{"code": "insufficient_motion"}, {"code": "background_instability"}]},
   "expect": {"max_changes": 1}},
  {"id": "always-rerolls-the-seed",
   "input": {"finding": {"code": "insufficient_motion"}},
   "expect": {"seed_changes": true}}
]
```
