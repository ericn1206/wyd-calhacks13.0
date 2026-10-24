# Architecture

## Target
```
Each laptop (Electron)                         Phone (web page)
  webcam → MediaPipe signals (local)             page hidden → phone_heartbeat(visible=false)
  active window → app/title/url → category              │
          │                                             │
          └── ingest_signal every 10 s ──→ SpacetimeDB ←┘
                                            │   ↑
               worker_pending_signal_events ↓   │ write_judgment, set_call_room_url,
                                      AI worker │ set_summary_text
               judge: Inferentia small model (fallback Claude Haiku)
               summary + replay captions: Claude
```
SpacetimeDB owns session state, smoothing, cooldowns, call/nudge triggers, and Pomodoro timers (scheduled reducers). Clients subscribe to `my_*` views. See `../components/spacetimedb.md`.

## Who writes what
| Data | Writer |
|---|---|
| Vision signals | desktop renderer (MediaPipe) |
| Activity (app/title/url/category) | desktop main |
| Phone state | phone page (`phone_heartbeat`), overrides desktop value when fresh |
| Judgment (status/confidence/reason) | AI worker; DB fallback rules when worker is stale |
| Smoothed status, calls, nudges, focus blocks, summaries (numbers) | SpacetimeDB reducers |
| Summary text, captions | AI worker (Claude) |

## Current reality
Desktop runs standalone: Goals submit → `wyd:tracking:start` → `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → `activity:*` IPC (UI does not consume yet). Renderer is the new Figma-Make UI with hardcoded demo data; spec in `../ui_integration.md`. Worker runs only as a fixtures CLI. No SpacetimeDB client anywhere. Details: `../status.md`.
