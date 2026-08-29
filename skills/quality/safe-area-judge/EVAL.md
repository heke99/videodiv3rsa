# Eval

```json
[
  {"id": "flags-a-caption-in-the-tiktok-chrome",
   "input": {"platform": "tiktok", "caption_bottom_fraction": 0.05},
   "expect": {"passed": false}},
  {"id": "passes-a-caption-above-the-chrome",
   "input": {"platform": "tiktok", "caption_bottom_fraction": 0.30},
   "expect": {"passed": true}},
  {"id": "recommends-layout-not-regeneration",
   "input": {"platform": "reels", "caption_bottom_fraction": 0.05},
   "expect": {"repair_scope": "caption"}}
]
```
