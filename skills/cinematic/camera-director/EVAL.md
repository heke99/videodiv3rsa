# Eval

```json
[
  {"id": "defaults-to-static",
   "input": {"shot": {"action": "she reads a label", "duration_frames": 48}},
   "expect": {"movement": "static"}},
  {"id": "moves-to-reveal",
   "input": {"shot": {"action": "the camera reveals the crowd behind her", "duration_frames": 96}},
   "expect": {"movement_not": "static"}},
  {"id": "refuses-movement-in-a-short-shot",
   "input": {"shot": {"action": "slow push in", "duration_frames": 30}},
   "expect": {"movement": "static"}}
]
```
