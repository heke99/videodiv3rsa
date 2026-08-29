# Eval

```json
[
  {"id": "gives-pauses-real-durations",
   "input": {"line": {"text": "I did not expect it to work. But it did."}},
   "expect": {"min_pause_ms": 200}},
  {"id": "breathes-on-long-lines",
   "input": {"line": {"text": "I had tried three different products over about six months and none of them made any difference at all to the texture"}},
   "expect": {"has_breath_pause": true}}
]
```
