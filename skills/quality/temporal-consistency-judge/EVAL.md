# Eval

```json
[
  {"id": "passes-a-stable-shot",
   "input": {"ssim_series": [0.98, 0.98, 0.97, 0.98], "motion": 0.1},
   "expect": {"passed": true}},
  {"id": "tolerates-low-similarity-under-fast-motion",
   "input": {"ssim_series": [0.6, 0.58, 0.61], "motion": 0.9},
   "expect": {"passed": true}},
  {"id": "flags-a-drop-without-motion",
   "input": {"ssim_series": [0.98, 0.97, 0.42, 0.96], "motion": 0.1},
   "expect": {"passed": false, "reports_frames": true}}
]
```
