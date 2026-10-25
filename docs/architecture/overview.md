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
| Vision signals | `vision/detector.py` + `vision/04_screen_monitor.py`, started from desktop main. Screen off-task x2, or screen on-task x2 plus webcam distracted x2, prints `face time`. |
| Activity (app/title/url/category) | desktop main |
| Phone state (optional) | phone page (`phone_heartbeat`), overrides desktop value when fresh |
| Judgment (status/confidence/reason) | AI worker; DB fallback rules when worker is stale |
| Smoothed status, calls, nudges, focus blocks, summaries (numbers) | SpacetimeDB reducers |
| Summary text, captions | AI worker (Claude) |

## Current reality
- Desktop: Goals submit → `wyd:tracking:start` → `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → `activity:*` IPC (UI does not consume yet). Same submit starts `vision/facetime_trigger.py`: screen off-task twice in a row, or screen on-task both times with the webcam distracted both times, prints `face time`. It does not open the overlay video popups. Renderer is the new Figma-Make UI (main window + a transparent full-screen overlay window for the dock/check-ins, relayed through main via `wyd:bridge:*`) with hardcoded demo data; spec in `../ui_integration.md`. Local `alert` starts the call. Video popups already in the overlay: `.glass-video`, `.checkin-timer-pop`, `.teammate-share-window`, `.duck-reflection-window` (`OverlayApp.tsx`), opened from the Demo menu.
- Calls + presence: desktop ↔ LiveKit Cloud directly (`../components/livekit-call.md`); not linked to DB `group_call`.
- SpacetimeDB client: `src/main/db/stdb.ts` in desktop main (snapshot/call IPC `wyd:db:*`); no `ingest_signal` sent yet. Worker runs only as a fixtures CLI.

Details: `../status.md`.
