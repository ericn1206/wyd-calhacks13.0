# Decisions

## Decided
| Date | Decision |
|---|---|
| — | Desktop: Electron + React + TypeScript (electron-vite). |
| — | Real-time sync: SpacetimeDB (module built in `spacetimedb/`). |
| — | All webcam processing local; text-only events and AI input. |
| — | Tone: gentle, social, no public shaming. |
| — | Claude for summaries + replay captions, one call per session. |
| 2026-10-24 | Check-in calls: LiveKit (LiveKit Cloud). See `../components/livekit-call.md`. |
| 2026-10-24 | No roasts, spoken or written. |
| 2026-10-24 | Phone sensor is optional; the app works fully without it. |
| 2026-10-24 | Onboarding: typed questionnaire (subject + goals). No AI voice. |
| 2026-10-24 | Webcam detector: Python sidecar (`vision/`) from the `webcam-activity-detection` branch; `04_screen_monitor.py` (Windows OCR + Gemini) excluded. |
| 2026-10-24 | Demo live view: one switch shows everyone's camera to the session; behind `LOCKIN_DEMO=1`. |

## Open (ask, don't assume)
| Question | Current direction / notes |
|---|---|
| Scores / leaderboard, or summary stats only? | Leaning no scores. DB has `score`, `session_award` (`scoreboard_enabled=false` by default). |
| Teammate "close your tab" takeover? | Needs explicit consent; likely cut. DB has `takeover_request`. |
| Canonical status vocabulary | Contract `on_task`/`off_task`/`break` vs DB `StatusLabel` vs desktop `productive`/`distracted`. |
| Canonical category set | Contract lowercase 9 vs DB `AppCategory` vs `appClassifier.ts`. |
| Event format | Contract JSON vs DB `SignalInput`. |
| Which judge runs in the demo | Desktop `claudeJudge.ts`, worker `judge.ts`, or DB fallback. |
| Timing numbers | Spec (2 min / 30 min / ~60 s) vs DB defaults (~60 s / 600 s / 90 s) vs LiveKit call 90 s. |
| Inferentia small model vs Haiku only | Not started. |
| Facial expression (DeepFace) | Fields exist in DB; not in the contract. |
| Alerts/integrations: Creao vs Factory, Slack recap, Notability PDF, Elastic | All optional; none built. |
| "Stuck" helper (`stuck_session`) | In DB; not in spec. |
