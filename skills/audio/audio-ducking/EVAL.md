# Eval

```json
[
  {"id": "attenuates-by-about-9db",
   "input": {"music": {"gain_db": -6}, "speech": [{"start_sample": 48000, "end_sample": 96000}]},
   "expect": {"attenuation_db_range": [-12, -6]}},
  {"id": "merges-close-lines",
   "input": {"speech": [{"start_sample": 0, "end_sample": 48000}, {"start_sample": 50000, "end_sample": 96000}]},
   "expect": {"duck_count": 1}},
  {"id": "does-not-duck-ambience",
   "input": {"beds": [{"kind": "AMBIENCE"}], "speech": [{"start_sample": 0, "end_sample": 48000}]},
   "expect": {"ducked_kinds_exclude": "AMBIENCE"}}
]
```
