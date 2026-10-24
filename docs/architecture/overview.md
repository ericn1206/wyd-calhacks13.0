# Architecture

## Target
```
Each laptop (Electron)                         Phone (web page, optional)
  webcam → MediaPipe signals (local)             page hidden → phone_heartbeat(visible=false)
  active window → app/title/url → category              │
          │                                             │
          └── ingest_signal every 10 s ──→ SpacetimeDB ←┘
                                            │   ↑
               worker_pending_signal_events ↓   │ write_judgment, set_call_room_url,
                                      AI worker │ set_summary_text
               judge: Inferentia small model (fallback Claude Haiku)
               summary + replay captions: Claude

CallIncoming alert (DB) → each laptop joins LiveKit room lockin-<CODE> → 90 s video check-in
```
SpacetimeDB owns session state, smoothing, cooldowns, call/nudge triggers, and Pomodoro timers (scheduled reducers). Clients subscribe to `my_*` views. See `../components/spacetimedb.md`.

## Who writes what
| Data | Writer |
|---|---|
| Vision signals | desktop renderer (MediaPipe) |
| Activity (app/title/url/category) | desktop main |
| Phone state (optional) | phone page (`phone_heartbeat`), overrides desktop value when fresh |
| Judgment (status/confidence/reason) | AI worker; DB fallback rules when worker is stale |
| Smoothed status, calls, nudges, focus blocks, summaries (numbers) | SpacetimeDB reducers |
| Summary text, captions | AI worker (Claude) |

## Current reality
- Desktop: `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → IPC → React UI. Local `alert` starts the call.
- Calls + presence: desktop ↔ LiveKit Cloud directly (`../components/livekit-call.md`); not linked to DB `group_call`.
- SpacetimeDB client: on a teammate branch, not on `main`. Worker runs only as a fixtures CLI.

Details: `../status.md`.
