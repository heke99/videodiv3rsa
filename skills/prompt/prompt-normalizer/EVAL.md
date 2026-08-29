# Eval

The normalizer must remove unrenderable language and keep visual specifics.

```json
[
  {"id": "strips-evaluative-language",
   "input": {"description": "A stunning breathtaking shot of a beautiful woman", "action": "she smiles"},
   "expect": {"not_contains": ["stunning", "breathtaking"], "contains_any": ["woman", "smile"]}},
  {"id": "keeps-light-direction",
   "input": {"description": "Backlit by a low sun through a window", "action": "she turns"},
   "expect": {"contains_any": ["backlit", "sun", "window"]}},
  {"id": "flags-multi-action",
   "input": {"description": "Kitchen", "action": "she picks it up, examines it, then sets it down"},
   "expect": {"single_action": true}}
]
```
