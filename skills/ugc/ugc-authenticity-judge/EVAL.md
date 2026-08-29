# Eval

```json
[
  {"id": "flags-overproduction",
   "input": {"metrics": {"lighting_evenness": 0.95, "framing_symmetry": 0.95}},
   "expect": {"finding_codes_contain": "overproduced"}},
  {"id": "flags-defects-separately",
   "input": {"metrics": {"identity_drift": 0.4}},
   "expect": {"finding_codes_contain": "identity_drift"}},
  {"id": "does-not-reward-mere-roughness",
   "input": {"metrics": {"lighting_evenness": 0.2, "framing_symmetry": 0.2, "exposure_error": 0.8}},
   "expect": {"score_max": 0.6}}
]
```
