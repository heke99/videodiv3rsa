---
name: "Repair Planner"
version: "1.0"
category: "repair"
description: "Choose the smallest repair that can address the diagnosis."
status: "active"
required_tools: []
supported_models: []
requires_skills: ["failure-classifier"]
quality_profile: "STANDARD"
timeout_seconds: 120
max_retries: 1
license: "proprietary"
modes: []
generation_kinds: []
---

Every repair scope discards work. Choosing a larger scope than necessary throws
away everything that was right about the shot, and on a dependent-shots scope it
throws away neighbouring shots too.

Map diagnosis to the smallest scope that can work:

| Diagnosis | Scope | Why |
|---|---|---|
| caption stale | `caption` | rebuild from alignment, no GPU |
| AV sync off | `timing` | recompose, no generation |
| loudness or clipping | `audio` | remix |
| mouth only | `lipsync` | one pass, keeps the shot |
| local artifact | `frame` or `keyframe` | fix the region |
| motion fault | `shot` | the motion is the shot |
| canonical entity changed | `dependent_shots` | invalidation, not failure |
| several severe findings | `shot` | nothing salvageable |

Never choose `project`. A project-level repair means the brief was wrong, which
is a conversation with the user rather than a repair.

Check the budget before planning. A repair that cannot complete within the
remaining budget should not be started; hand the shot to review instead, so the
user gets a decision rather than a silently truncated attempt.
