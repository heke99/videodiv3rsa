# Eval

```json
[
  {"id": "names-sources-not-moods",
   "input": {"shot": {"description": "a woman opens a jar in a quiet kitchen"}, "target_duration_samples": 96000},
   "expect": {"contains_any": ["jar", "lid", "kitchen"], "not_contains": ["tense", "atmosphere", "mood"]}},
  {"id": "includes-room-tone",
   "input": {"shot": {"description": "an office interior"}, "target_duration_samples": 96000},
   "expect": {"has_room_tone_clause": true}},
  {"id": "never-requests-speech-or-music",
   "input": {"shot": {"description": "two people talking in a cafe"}, "target_duration_samples": 96000},
   "expect": {"not_contains": ["dialogue", "voice", "music", "song"]}}
]
```
