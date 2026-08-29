# Eval

```json
[
  {"id": "asks-for-asymmetry",
   "input": {"shot": {"shot_type": "closeup"}},
   "expect": {"has_asymmetry_clause": true}},
  {"id": "asks-for-skin-texture-on-a-closeup",
   "input": {"shot": {"shot_type": "closeup", "character_ids": ["c1"]}},
   "expect": {"has_skin_texture_clause": true}},
  {"id": "never-names-the-artifact",
   "input": {"shot": {"description": "a portrait"}},
   "expect": {"not_contains": ["AI look", "not AI", "artificial looking"]}}
]
```
