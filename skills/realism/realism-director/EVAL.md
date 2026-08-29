# Eval

```json
[
  {"id": "never-uses-realism-adjectives",
   "input": {"shot": {"description": "a kitchen scene"}},
   "expect": {"not_contains": ["photorealistic", "ultra realistic", "8k", "hyperdetailed", "masterpiece"]}},
  {"id": "adds-a-specific-imperfection",
   "input": {"shot": {"description": "a bottle on a counter"}},
   "expect": {"has_imperfection_clause": true}}
]
```
