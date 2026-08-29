# Eval

```json
[
  {"id": "matches-posture-to-intent",
   "input": {"shot": {"action": "she says she was sceptical at first"}},
   "expect": {"posture_in": ["closed", "guarded", "small"]}},
  {"id": "keeps-gestures-sparse",
   "input": {"shot": {"action": "he explains the feature", "duration_frames": 96}},
   "expect": {"max_gestures": 2}}
]
```
