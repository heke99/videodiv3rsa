# Eval

```json
[
  {"id": "remixes-rather-than-regenerating-for-level",
   "input": {"finding": {"code": "loudness_off_target"}},
   "expect": {"action": "renormalize", "regenerates_speech": false}},
  {"id": "regenerates-only-for-damaged-audio",
   "input": {"finding": {"code": "clipping", "source": "generation"}},
   "expect": {"regenerates_speech": true}},
  {"id": "adds-room-tone-for-silence",
   "input": {"finding": {"code": "silent_gap"}},
   "expect": {"action": "add_ambience"}}
]
```
