# Eval

```json
[
  {"id": "checks-against-the-profile",
   "input": {"measured_lufs": -14.2, "profile": "social"},
   "expect": {"passed": true}},
  {"id": "fails-when-too-loud",
   "input": {"measured_lufs": -9.0, "profile": "social"},
   "expect": {"passed": false}},
  {"id": "fails-on-true-peak",
   "input": {"measured_lufs": -14.0, "true_peak_dbtp": 0.3, "profile": "social"},
   "expect": {"passed": false}},
  {"id": "flags-an-over-compressed-mix",
   "input": {"measured_lufs": -14.0, "lra": 0.5, "profile": "social"},
   "expect": {"finding_codes_contain": "over_compressed"}}
]
```
