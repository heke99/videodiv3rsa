# Eval

```json
[
  {"id": "biases-upward-in-vertical",
   "input": {"shot": {"shot_type": "medium"}, "aspect_ratio": "9:16"},
   "expect": {"subject_above_centre": true}},
  {"id": "keeps-readable-content-out-of-the-lower-fifth",
   "input": {"shot": {"shot_type": "product_hero"}, "aspect_ratio": "9:16"},
   "expect": {"avoids_lower_fifth": true}},
  {"id": "close-up-when-expression-carries-the-shot",
   "input": {"shot": {"action": "she realises it worked"}},
   "expect": {"shot_type_in": ["closeup", "medium"]}}
]
```
