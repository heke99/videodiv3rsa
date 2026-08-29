# Eval

```json
[
  {"id": "uses-deep-focus",
   "input": {"shot": {"description": "creator selfie"}},
   "expect": {"depth_of_field": "deep"}},
  {"id": "blows-out-the-window",
   "input": {"shot": {"description": "creator in front of a window"}},
   "expect": {"has_blown_highlights": true}},
  {"id": "does-not-ask-for-violent-shake",
   "input": {"shot": {"description": "handheld selfie"}},
   "expect": {"not_contains": ["shaky", "violent shake"]}}
]
```
