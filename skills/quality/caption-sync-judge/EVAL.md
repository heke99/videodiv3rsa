# Eval

```json
[
  {"id": "catches-a-stale-caption",
   "input": {"caption": {"start_sample": 0, "end_sample": 48000, "text": "old wording"},
             "speech": {"start_sample": 96000, "end_sample": 144000, "text": "new wording"}},
   "expect": {"passed": false}},
  {"id": "catches-an-unreadably-fast-cue",
   "input": {"caption": {"start_sample": 0, "end_sample": 4800, "text": "this is a very long caption to read"}},
   "expect": {"passed": false, "finding_codes_contain": "caption_too_fast"}}
]
```
