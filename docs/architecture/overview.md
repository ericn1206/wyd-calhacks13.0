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

CallIncoming alert (DB) → each laptop joins LiveKit room lockin-<CODE> → 30 s video check-in
```
SpacetimeDB owns session state, smoothing, cooldowns, call/nudge triggers, and Pomodoro timers (scheduled reducers). Clients subscribe to `my_*` views. See `../components/spacetimedb.md`.

## Off-task pipeline
Target (decided 2026-10-24; **not built**, no OCR/Gemini code exists):
```
every few seconds, on each laptop (Electron main)
  screenshot (stays local) → local OCR model → text
  text → Gemini API → OnTask | OffTask
  → ingest_signal(app_category = OnTask|OffTask, active_app/title/domain)
SpacetimeDB (same transaction as `ingest_signal`): judgment → status flips to OffTask immediately → maybe_trigger_group_call (measured ~90 ms to the other client)
  → CallIncoming alert to the other members → their clients join the LiveKit room
```
- Only OCR text leaves the laptop (to Gemini); screenshots never do. OCR text can contain on-screen private content: see `product/decisions.md`.
- Classification is binary everywhere in the DB (`AppCategory` = `OnTask`/`OffTask`); the DB rule table no longer classifies.
- No hold on OffTask: `ingest_signal` judges, flips status and triggers in one call; `off_task_threshold_secs` defaults to 0. Returning to on-task still waits `smoothing_hold_secs` (60 s). Limits that remain: `call_cooldown_secs` 600 (inside cooldown the member gets a `NudgeSelf` instead of a call), one call-or-nudge per off-task episode, ≥2 members for a call.
- Needs: OCR choice, `GEMINI_API_KEY` (see `stack.md`), capture interval, Screen Recording permission.

## Who writes what
| Data | Writer |
|---|---|
| Vision + screen signals | `vision/facetime_trigger.py` (spawned by `src/main/facetimeTrigger.ts` on `wyd:tracking:start`) runs `vision/detector.py` (webcam) + `vision/04_screen_monitor.py` (macOS Vision OCR → Gemini) every 10 s. Screen off-task x2, or screen on-task x2 plus webcam distracted x2, prints `face time` → `wyd:facetime` → local check-in. |
| Activity (app/title/url/category) | desktop main (`activityMonitor.ts`) |
| Phone state (optional) | phone page (`phone_heartbeat`), overrides desktop value when fresh |
| Judgment (status/confidence/reason) | AI worker; DB fallback rules when worker is stale |
| Smoothed status, calls, nudges, focus blocks, summaries (numbers) | SpacetimeDB reducers |
| Summary text, captions | AI worker (Claude) |

## Current reality
- Desktop: Goals submit → `wyd:tracking:start` → `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → `activity:*` IPC (UI does not consume yet). Same submit starts `vision/facetime_trigger.py`: screen off-task twice in a row, or screen on-task both times with the webcam distracted both times, prints `face time`. A `face time` line shows the overlay and starts the real LiveKit check-in (`overlay/LiveCheckIn.tsx`). Renderer is the new Figma-Make UI (main window + a transparent full-screen overlay window for the dock/check-ins, relayed through main via `wyd:bridge:*`) with hardcoded demo data; spec in `../ui_integration.md`. Mock video popups still in the overlay: `.glass-video`, `.checkin-timer-pop`, `.teammate-share-window`, `.duck-reflection-window` (`OverlayApp.tsx`), opened from the Demo menu.
- Calls + presence: desktop ↔ LiveKit Cloud directly (`../components/livekit-call.md`), triggered by `face time`; not linked to DB `group_call`.
- SpacetimeDB client: `src/main/db/stdb.ts` holds the one connection (main process), mirrors `my_*` views to the main window as plain-JSON snapshots (`wyd:db:state`), and executes reducers via `wyd:db:call`. Renderer hook: `src/renderer/src/db/useDb.ts`. The overlay window gets DB-derived state only through `App.tsx` → `OverlayState`. Debug log: `src/main/db/debugLog.ts`. Worker runs only as a fixtures CLI.

Details: `../status.md`.
