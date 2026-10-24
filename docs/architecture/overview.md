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
Desktop runs standalone: `osascript` polling → `categorize.ts` + `claudeJudge.ts` in main → IPC → React UI. Worker runs only as a fixtures CLI. No SpacetimeDB client anywhere. Details: `../status.md`.
