# Eval

```json
[
  {"id": "places-effects-on-the-contact-frame",
   "input": {"shot": {"action": "she sets the jar down", "contact_frame": 34}},
   "expect": {"effect_frame": 34}},
  {"id": "does-not-fill-every-movement",
   "input": {"shot": {"action": "she walks in, sits, picks up a cup, drinks, sets it down"}},
   "expect": {"max_effects": 4}}
]
```
