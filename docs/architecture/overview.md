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
| Vision signals | desktop renderer (MediaPipe) |
| Activity (app/title/url) and the OnTask/OffTask verdict | desktop main (OCR + Gemini) |
| Phone state (optional) | phone page (`phone_heartbeat`), overrides desktop value when fresh |
| Judgment (status/confidence/reason) | AI worker; DB fallback rules when worker is stale |
| Smoothed status, calls, nudges, focus blocks, summaries (numbers) | SpacetimeDB reducers |
| Summary text, captions | AI worker (Claude) |

## Current reality
- Desktop: Goals submit → `wyd:tracking:start` → `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → `activity:*` IPC (UI does not consume yet). Renderer is the new Figma-Make UI (main window + a transparent full-screen overlay window for the dock/check-ins, relayed through main via `wyd:bridge:*`) with hardcoded demo data; spec in `../ui_integration.md`. Local `alert` starts the call.
- Calls + presence: desktop ↔ LiveKit Cloud directly (`../components/livekit-call.md`); not linked to DB `group_call`.
- SpacetimeDB client: `src/main/db/stdb.ts` holds the one connection (main process), mirrors `my_*` views to the main window as plain-JSON snapshots (`wyd:db:state`), and executes reducers via `wyd:db:call`. Renderer hook: `src/renderer/src/db/useDb.ts`. The overlay window gets DB-derived state only through `App.tsx` → `OverlayState`. Debug log: `src/main/db/debugLog.ts`. Worker runs only as a fixtures CLI.

Details: `../status.md`.
