# Eval

```json
[
  {"id": "passes-stable-footage",
   "input": {"luma_series": [100, 100.4, 100.2, 100.5, 100.3]},
   "expect": {"passed": true}},
  {"id": "catches-oscillation",
   "input": {"luma_series": [100, 118, 99, 120, 98, 119]},
   "expect": {"passed": false, "finding_codes_contain": "flicker"}},
  {"id": "does-not-flag-a-legitimate-light-change",
   "input": {"luma_series": [60, 61, 62, 105, 106, 107]},
   "expect": {"passed": true}}
]
```
