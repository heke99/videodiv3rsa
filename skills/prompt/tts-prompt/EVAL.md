# Eval

```json
[
  {"id": "expands-numerals",
   "input": {"line": {"text": "It has 15% vitamin C"}, "voice": {"language": "en"}},
   "expect": {"contains_any": ["fifteen percent"], "not_contains": ["15%"]}},
  {"id": "keeps-directions-out-of-the-text",
   "input": {"line": {"text": "I love it", "emotion": "warm"}, "voice": {"language": "en"}},
   "expect": {"not_contains": ["(warmly)", "[warm]"]}},
  {"id": "passes-pronunciation-hints-through",
   "input": {"line": {"text": "Try Nuvei today", "pronunciation_hints": {"Nuvei": "noo-VAY"}}, "voice": {"language": "en"}},
   "expect": {"has_pronunciation_hints": true}}
]
```
