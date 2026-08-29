# Eval

```json
[
  {"id": "states-exact-strings",
   "input": {"shot": {"product_ids": ["p1"]}, "product": {"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C"]}},
   "expect": {"contains_all": ["NOVA", "15% Vitamin C"]}},
  {"id": "limits-readable-text",
   "input": {"shot": {"product_ids": ["p1"]},
             "product": {"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C", "30ml", "made in sweden", "batch 4471"]}},
   "expect": {"max_readable_strings": 2}},
  {"id": "keeps-text-shots-short",
   "input": {"shot": {"product_ids": ["p1"], "duration_frames": 240, "requires_product_fidelity": true}},
   "expect": {"flags_duration": true}}
]
```
