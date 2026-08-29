# Eval

```json
[
  {"id": "uses-no-gpu",
   "input": {"finding": {"code": "av_sync"}},
   "expect": {"gpu_seconds": 0}},
  {"id": "extends-rather-than-compressing",
   "input": {"finding": {"code": "speech_overruns_shot"}},
   "expect": {"action": "extend_shot"}}
]
```
