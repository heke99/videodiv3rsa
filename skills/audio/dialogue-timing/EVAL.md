# Eval

```json
[
  {"id": "extends-before-compressing",
   "input": {"shot": {"duration_frames": 48}, "dialogue": {"length_samples": 120000}},
   "expect": {"action": "extend_shot"}},
  {"id": "never-compresses-first",
   "input": {"shot": {"duration_frames": 48}, "dialogue": {"length_samples": 120000}},
   "expect": {"action_not": "increase_speech_rate"}},
  {"id": "leaves-a-tail",
   "input": {"shot": {"duration_frames": 96}, "dialogue": {"length_samples": 96000}},
   "expect": {"has_tail_frames": true}}
]
```
