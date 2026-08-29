# Eval

```json
[
  {"id": "eases-both-ends",
   "input": {"shot": {"camera": {"movement": "push in"}, "duration_frames": 96}},
   "expect": {"has_ease_in": true, "has_ease_out": true}},
  {"id": "settles-before-the-cut",
   "input": {"shot": {"camera": {"movement": "pan"}, "duration_frames": 96}},
   "expect": {"settles_before_end": true}}
]
```
