# Eval

```json
[
  {"id": "catches-the-wrong-pixel-format",
   "input": {"pixel_format": "yuv444p"},
   "expect": {"passed": false, "finding_codes_contain": "pixel_format"}},
  {"id": "catches-a-missing-fast-start",
   "input": {"faststart": false},
   "expect": {"passed": false}},
  {"id": "catches-a-frame-rate-mismatch",
   "input": {"fps_num": 30, "fps_den": 1, "expected_fps_num": 24, "expected_fps_den": 1},
   "expect": {"passed": false}}
]
```
