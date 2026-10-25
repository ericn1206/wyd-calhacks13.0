# Decisions

## Decided
| Date | Decision |
|---|---|
| — | Desktop: Electron + React + TypeScript (electron-vite). |
| — | Real-time sync: SpacetimeDB (module built in `spacetimedb/`). |
| — | Tone: gentle, social, no public shaming. |
| — | Claude for summaries + replay captions, one call per session. |
| 2026-10-24 | Check-in calls: LiveKit (LiveKit Cloud). See `../components/livekit-call.md`. |
| 2026-10-24 | No roasts, spoken or written. |
| 2026-10-24 | Phone sensor is optional; the app works fully without it. |
| 2026-10-24 | Onboarding: typed questionnaire (subject + goals). No AI voice. Prod's voice intro is merged but kept off (unrouted) for now. |
| 2026-10-25 | Goals screen asks one question: "What do you want to do?" That sentence is the goal Gemini judges. No sites/apps or extra-notes fields. Detector runs only while a round's timer runs. Every 5 s: screenshot stays local, OCR text → Gemini (front app is context, not a whitelist; planning tools count as on task). Dock pill shows On task or Off task plus Gemini's short line about the latest screenshot. |
| 2026-10-24 | Off-task is announced immediately: no hold, `off_task_threshold_secs` default 0; others learn at once. Privacy updated to allow OCR text → Gemini (`privacy.md`). |
| 2026-10-24 | DB categories are binary: `AppCategory` = `OnTask`/`OffTask`. |
| 2026-10-24 | Off-task detection: local OCR of screenshots every few seconds → Gemini API → OnTask/OffTask → `ingest_signal` → off-task event → other clients get a call alert. See `../architecture/overview.md#off-task-pipeline`. |
| 2026-10-24 | Off-task clips: each check-in saves a 30 s webcam clip of the unfocused person (10 s before, 20 s after), uploaded to SpacetimeDB (`session_clip`) as soon as it is recorded, for an end-of-session compilation (not built). |
| 2026-10-25 | Session clip compilation: a Node worker subscribes to the db (no procedures/webhooks), joins the clips with ffmpeg and hosts the video itself; runs locally in dev/testing. Individual clips stay in SpacetimeDB. Hosting for the real demo (LAN IP vs tunnel vs cloud) still open. |
| 2026-10-25 | No privacy restrictions: video/screenshots/text may leave the laptop and be stored (`privacy.md`, `CLAUDE.md`). Replaces "all webcam processing local". |
| 2026-10-25 | Clips are the drifter's own screen recording (WYD windows excluded) with their webcam inset, 1280×720 / 10 fps, recorded on their laptop and uploaded from there, not captured from the LiveKit call. |
| 2026-10-24 | No pause. Host can force a break (`take_break`) and end the session (`end_session`); only the host ends a session (no auto-end). Disconnected members are removed after 60 s. |

## Open (ask, don't assume)
| Question | Current direction / notes |
|---|---|
| Scores / leaderboard, or summary stats only? | Leaning no scores. DB has `score`, `session_award` (`scoreboard_enabled=false` by default). |
| Teammate "close your tab" takeover? | Needs explicit consent; likely cut. DB has `takeover_request`. |
| Canonical status vocabulary | Contract `on_task`/`off_task`/`break` vs DB `StatusLabel` vs desktop `productive`/`distracted`. |
| Event format | Contract JSON vs DB `SignalInput`. |
| Where the AI worker runs | SpacetimeDB can't host a Node process; options: separate always-on process (VM/laptop) or port judge into module procedures (HTTP). Requested: "hosted on SpacetimeDB cloud". |
| Gemini pipeline vs project rules | `CLAUDE.md` says rules + cache first, only ambiguous titles go to a model, Claude judge. The decided pipeline calls Gemini every few seconds on OCR text. Update `CLAUDE.md`/`privacy.md` wording or add a cache; cost + on-screen text sent to Gemini. |
| Which judge runs in the demo | Desktop `claudeJudge.ts`, worker `judge.ts`, or DB fallback. |
| Timing numbers | Spec (2 min / 30 min / ~60 s) vs DB defaults (~60 s / 600 s / 90 s) vs LiveKit call 30 s. |
| Inferentia small model vs Haiku only | Not started. |
| Facial expression (DeepFace) | Fields exist in DB; not in the contract. |
| Alerts/integrations: Creao vs Factory, Slack recap, Notability PDF, Elastic | All optional; none built. |
| "Stuck" helper (`stuck_session`) | In DB; not in spec. |
