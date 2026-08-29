# Eval

Negative terms must be selected by what the shot contains.

```json
[
  {"id": "hands-shot-gets-hand-terms",
   "input": {"shot": {"description": "close on her hands opening the jar"}},
   "expect": {"contains_any": ["finger", "hand"]}},
  {"id": "landscape-does-not-get-hand-terms",
   "input": {"shot": {"description": "wide establishing shot of an empty valley at dawn"}},
   "expect": {"not_contains": ["finger", "extra limbs"]}},
  {"id": "stays-short",
   "input": {"shot": {"description": "a man walks across a room"}},
   "expect": {"max_terms": 8}}
]
```
