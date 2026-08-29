# Eval

```json
[
  {"id": "catches-clipping",
   "input": {"peak_dbfs": 0.0, "consecutive_max_samples": 12},
   "expect": {"passed": false, "finding_codes_contain": "clipping"}},
  {"id": "catches-a-silent-dialogue-track",
   "input": {"track": "DIALOGUE", "silent_ratio": 0.99},
   "expect": {"passed": false}},
  {"id": "catches-over-compression",
   "input": {"lra": 0.4},
   "expect": {"finding_codes_contain": "over_compressed"}}
]
```
