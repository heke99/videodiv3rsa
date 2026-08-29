# Eval

```json
[
  {"id": "expresses-an-arc",
   "input": {"shot": {"action": "she recognises what it does"}},
   "expect": {"has_arc": true}},
  {"id": "specifies-the-eyes-separately",
   "input": {"shot": {"action": "she smiles"}},
   "expect": {"mentions_eyes": true}},
  {"id": "includes-blinking",
   "input": {"shot": {"shot_type": "closeup", "duration_frames": 96}},
   "expect": {"has_blink_clause": true}}
]
```
