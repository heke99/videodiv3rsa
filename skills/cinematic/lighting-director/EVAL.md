# Eval

```json
[
  {"id": "always-states-direction",
   "input": {"shot": {"description": "a woman at a desk"}},
   "expect": {"has_direction_clause": true}},
  {"id": "always-states-hardness",
   "input": {"shot": {"description": "a woman at a desk"}},
   "expect": {"has_hardness_clause": true}},
  {"id": "avoids-flat-front-light-by-default",
   "input": {"shot": {"description": "a portrait"}},
   "expect": {"direction_not": "flat front"}}
]
```
