# Eval

```json
[
  {"id": "stays-in-voice",
   "input": {"script": {"tone": ["casual", "dry"]}},
   "expect": {"not_contains": ["transform", "today only", "click the link below"]}},
  {"id": "single-action",
   "input": {"brief": {"cta": "follow, like and visit the site"}},
   "expect": {"cta_count": 1}}
]
```
