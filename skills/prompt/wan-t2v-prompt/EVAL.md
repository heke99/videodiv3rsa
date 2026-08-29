# Eval

The T2V compiler must front-load the subject and never claim a specific identity.

```json
[
  {"id": "leads-with-subject",
   "input": {"shot": {"description": "a quiet street at dawn", "action": "a cyclist rides past"}},
   "expect": {"subject_in_first_sentence": true}},
  {"id": "always-specifies-background",
   "input": {"shot": {"description": "a man stands", "action": "he looks up"}},
   "expect": {"has_environment_clause": true}},
  {"id": "always-specifies-light",
   "input": {"shot": {"description": "a kitchen", "action": "steam rises from a cup"}},
   "expect": {"has_light_clause": true}},
  {"id": "does-not-name-a-canonical-character",
   "input": {"shot": {"description": "character_001 walks", "character_ids": ["character_001"]}},
   "expect": {"not_contains": ["character_001"]}},
  {"id": "stays-under-length-budget",
   "input": {"shot": {"description": "a busy market", "action": "a vendor arranges fruit"}},
   "expect": {"max_words": 80}}
]
```
