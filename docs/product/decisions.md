# Decisions

## Decided
| Date | Decision |
|---|---|
| — | Desktop: Electron + React + TypeScript (electron-vite). |
| — | Real-time sync: SpacetimeDB (module built in `spacetimedb/`). |
| — | All webcam processing local; text-only events and AI input. |
| — | Tone: gentle, social, no public shaming. |
| — | Claude for summaries + replay captions, one call per session. |

## Open (ask, don't assume)
| Question | Current direction / notes |
|---|---|
| Scores / leaderboard, or summary stats only? | Leaning no scores. DB has `score`, `session_award` (`scoreboard_enabled=false` by default). |
| Spoken roasts / voice? | Leaning no roasts. Cartesia optional for calm cues. |
| Teammate "close your tab" takeover? | Needs explicit consent; likely cut. DB has `takeover_request`. |
| Check-in call provider (Daily / LiveKit / Jitsi / other)? | Undecided; `call_room_base_url` empty. |
| Canonical status vocabulary | Contract `on_task`/`off_task`/`break` vs DB `StatusLabel` vs desktop `productive`/`distracted`. |
| Canonical category set | Contract lowercase 9 vs DB `AppCategory` vs `appClassifier.ts`. |
| Event format | Contract JSON vs DB `SignalInput`. |
| Which judge runs in the demo | Desktop `claudeJudge.ts`, worker `judge.ts`, or DB fallback. |
| Timing numbers | Spec (2 min / 30 min / ~60 s) vs DB defaults (~60 s / 600 s / 90 s). |
| Inferentia small model vs Haiku only | Not started. |
| Facial expression (DeepFace) | Fields exist in DB; not in the contract. |
| Alerts/integrations: Creao vs Factory, Slack recap, Notability PDF, Elastic | All optional; none built. |
| "Stuck" helper (`stuck_session`) | In DB; not in spec. |
