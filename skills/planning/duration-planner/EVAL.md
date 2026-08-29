# Eval

```json
[
  {"id": "gives-dialogue-shots-their-measured-length",
   "input": {"shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 96000}], "sample_rate": 48000, "fps": 24},
   "expect": {"s1_min_frames": 48}},
  {"id": "adjusts-non-dialogue-shots-to-fit",
   "input": {"target_frames": 240, "shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 192000},
                                             {"id": "s2", "has_dialogue": false}], "sample_rate": 48000, "fps": 24},
   "expect": {"adjusted": ["s2"]}},
  {"id": "reports-an-over-long-script",
   "input": {"target_frames": 120, "shots": [{"id": "s1", "has_dialogue": true, "dialogue_samples": 480000}], "sample_rate": 48000, "fps": 24},
   "expect": {"script_too_long": true}}
]
```
