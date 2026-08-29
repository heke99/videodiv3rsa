# Eval

```json
[
  {"id": "places-a-pause-before-the-claim",
   "input": {"script": {"lines": [{"text": "I tried it for two weeks"}, {"text": "and my skin actually cleared up"}]}},
   "expect": {"pause_before_claim": true}},
  {"id": "keeps-pauses-few",
   "input": {"script": {"target_duration_seconds": 30}},
   "expect": {"max_pauses": 3}}
]
```
