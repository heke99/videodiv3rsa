# Eval

```json
[
  {"id": "face-is-structural-not-evaluative",
   "input": {"shot": {"description": "portrait of the creator"}, "entities": {"characters": [{"id": "c1"}]}},
   "expect": {"not_contains": ["beautiful", "gorgeous", "stunning"]}},
  {"id": "product-text-is-stated-exactly",
   "input": {"shot": {"description": "the bottle on marble", "requires_product_fidelity": true},
             "entities": {"products": [{"id": "p1", "on_pack_text": ["NOVA", "15% Vitamin C"]}]}},
   "expect": {"contains_all": ["NOVA", "15% Vitamin C"]}},
  {"id": "edit-mode-describes-only-the-change",
   "input": {"shot": {"description": "change the background to a bathroom"}, "mode": "edit"},
   "expect": {"max_words": 30}},
  {"id": "leaves-room-for-the-movement",
   "input": {"shot": {"description": "she is about to walk forward", "action": "walks toward camera"}},
   "expect": {"has_headroom_clause": true}}
]
```
