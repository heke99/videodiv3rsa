# Eval

```json
[
  {"id": "does-not-open-on-the-product",
   "input": {"brief": {"product": {"name": "NOVA serum"}}},
   "expect": {"first_line_not_contains": ["NOVA"]}},
  {"id": "avoids-greeting-openers",
   "input": {"brief": {"platform": "tiktok"}},
   "expect": {"not_contains": ["hey guys", "hi everyone", "what's up"]}},
  {"id": "is-specific",
   "input": {"brief": {"problem": "retinol irritation"}},
   "expect": {"has_specific_detail": true}}
]
```
