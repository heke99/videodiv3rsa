# Eval

```json
[
  {"id": "collects-brand-names",
   "input": {"brief": {"product": {"name": "Nuvei"}}},
   "expect": {"has_hint_for": "Nuvei"}},
  {"id": "stores-hints-on-the-voice-profile",
   "input": {"brief": {"product": {"name": "Nuvei"}}},
   "expect": {"stored_on_voice_profile": true}},
  {"id": "resolves-ambiguous-words",
   "input": {"line": {"text": "she read the label"}},
   "expect": {"has_hint_for": "read"}}
]
```
