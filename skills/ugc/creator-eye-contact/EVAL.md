# Eval

```json
[
  {"id": "direct-address-uses-the-lens",
   "input": {"line": {"text": "if you have tried these and they made you peel", "role": "hook"}},
   "expect": {"gaze": "lens"}},
  {"id": "breaks-contact-in-a-long-take",
   "input": {"shot": {"duration_frames": 240, "has_dialogue": true}},
   "expect": {"has_gaze_break": true}},
  {"id": "never-a-fixed-stare",
   "input": {"shot": {"duration_frames": 240, "has_dialogue": true}},
   "expect": {"gaze_not": "fixed"}}
]
```
