# Eval

```json
[
  {"id": "puts-camera-above-eye-level",
   "input": {"shot": {"shot_type": "selfie"}},
   "expect": {"camera_height": "above_eye_level"}},
  {"id": "looks-at-the-lens",
   "input": {"shot": {"shot_type": "selfie", "has_dialogue": true}},
   "expect": {"gaze": "lens"}},
  {"id": "no-smooth-camera-movement",
   "input": {"shot": {"shot_type": "selfie"}},
   "expect": {"movement": "static"}}
]
```
