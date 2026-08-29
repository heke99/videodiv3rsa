# Eval

```json
[
  {"id": "passes-exact-placement",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 48010},
   "expect": {"passed": true}},
  {"id": "fails-early-audio-sooner",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 44000},
   "expect": {"passed": false}},
  {"id": "tolerates-slightly-late-audio",
   "input": {"expected_start_sample": 48000, "measured_start_sample": 51000},
   "expect": {"passed": true}}
]
```
