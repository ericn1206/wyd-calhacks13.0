# Status

Last updated: 2026-10-24 (session clips). Biggest gap: only the detector's OnTask/OffTask verdict reaches SpacetimeDB (`ingest_signal` from `App.tsx`, every 10 s while Active/Break); webcam/activity fields are sent neutral. Session create/join, goals, lobby roster, shared Pomodoro timer work against maincloud. Worker runs without the DB.

## Built
| Part | Path | What works |
|---|---|---|
| SpacetimeDB module | `spacetimedb/` | Full schema + 37 reducers: sessions, goals, Pomodoro timers, `ingest_signal`, smoothing, fallback judge, scoring, call/nudge trigger, phone pairing, finalize + awards. Configured for maincloud db `calhacks-13-wyd`. See `components/spacetimedb.md`. |
| Desktop activity tracking | `src/main/activityMonitor.ts` | Polls front app + window title + browser URL (Chrome/Safari/Arc/Brave) every 2 s via `osascript`. macOS only. |
| Distraction trigger | `vision/facetime_trigger.py`, `vision/detector.py`, `vision/04_screen_monitor.py`, `src/main/facetimeTrigger.ts` | Goals submit starts both detectors. Screen off-task twice in a row, or screen on-task twice with webcam distracted both times, prints `face time`. See `components/vision.md`. |
| Desktop `.env` loader | `src/main/env.ts` | Loads root `.env` into `process.env` at startup (no override of shell vars). |
| Desktop categorization | `src/main/categorize.ts` | Rules + cache → contract categories (`coding`…`unknown`). Fills `activity.category`. |
| Desktop judge | `src/main/claudeJudge.ts` | Claude call every 8 s once session context exists; output drives local alerts (30 s warning, 60 s alert). |
| Check-in calls (LiveKit) | `src/main/livekitToken.ts`, `src/renderer/src/useCircleCall.ts` (old UI in `outdated/`: `VideoCall.tsx`) | Detector `face time` → own 30 s call with camera + screen share (overlay hidden from the capture); teammates get a 3 s Join invite and see the share window; alone → duck window with Resume. See `components/livekit-call.md`. |
| Detector debug + status sync | `vision/facetime_trigger.py` (`status`/`debug` lines), `src/main/facetimeTrigger.ts`, `components/session/DetectorLog.tsx` | Verdict → `ingest_signal` → status dots on every screen; Demo menu: dock debug strip toggle + detector log (last 300). Dock shows Idle / Not tracking / Camera off outside a running round. See `components/vision.md`. |
| Desktop UI | `src/renderer/src/` (+ `docs/ui_integration.md`) · dock + check-ins in full-screen overlay window (`overlay/OverlayApp.tsx`) | New Figma-Make UI: entry, intro, goals, focus workspace, dock, check-in windows, break, summary. All data hardcoded/local; Demo menu simulates events. Goals submit calls `wyd:tracking:start`. |
| Desktop DB client | `src/main/db/stdb.ts`, `src/renderer/src/db/useDb.ts` | Single main-process connection; token persisted; create/join session, `set_pomodoro`, `start_session`, shared timer + phase flip to break, goals + `check_goal`, roster, `leave_session`. Verified headless with 2 clients 2026-10-24; UI click-through untested. Debug log: see `architecture/stack.md` (`WYD_DEBUG`). |
| Session clips | `vision/detector.py` (`ClipRecorder`), `src/main/clipUpload.ts`, `session_clip*` in `spacetimedb/` | Check-in (`face time`, DB session live) → 30 s webcam clip (10 s before, 20 s after) → chunked upload as soon as recorded, tied to session + unfocused member. Verified 2026-10-24: encoder on synthetic frames, 2.4 MB upload on a local db, bytes identical. Not run with a real camera / Electron click-through. See `architecture/contracts.md#session-clips`. |
| Worker judge | `worker/judge.ts` | Text-only judge over 2-min window → `{status, confidence, reason}`; failure → confidence 0 (neutral). |
| Worker categorizer | `worker/categorizeUnknown.ts` | Model categorization for `unknown` titles, cached. |
| Worker fixtures | `worker/runFixtures.ts` | 15 scenarios, `npm run fixtures`. |

## Stubbed
- Voice AI onboarding: prod's `VoiceScreen.tsx` / `cartesiaCall.ts` / `session:*` IPC are merged but unrouted (voice off for now, `product/decisions.md`); goals come from the Goals screen.
- Call room: `call_room_base_url` setting is `""`; no provider chosen.

## Missing
- UI wiring still open: see table below (activity → DB, check-in from alerts, LiveKit video). `activity:update`/`activity:alert` not consumed (UI uses Demo-menu triggers).
- Off-task pipeline: local OCR + Gemini classification → `ingest_signal` (`architecture/overview.md#off-task-pipeline`). Replaces desktop `categorize.ts`/`appClassifier.ts`/`claudeJudge.ts` as the verdict source.
- Pomodoro: in a DB session all clocks/screens derive from the server (`components/spacetimedb.md#behavior`, skew-corrected); the local timer, `finishPomodoro`, break countdown and "Back to focus" exist only in the offline demo flow. Long (20 min) break / "of 4" rounds: demo flow only.
- Pause: decided against. Host has `take_break` (force a break now, work round only) and `end_session`; the DB-session dock shows Start (lobby) + Take a break only.
- Session lifecycle (published to maincloud 2026-10-25, additive): resume after restart, ended session → summary with real stats, host End session, 60 s disconnect reaper (`disconnect_timer`), name input (`set_profile`). Module verified via CLI on a scratch db; UI click-through untested.
- Worker ↔ SpacetimeDB: no subscription to `worker_pending_signal_events`, no `write_judgment`.
- Session compilation: no code joins a session's clips into one video or produces links. Plan: worker reads complete `session_clip` rows + chunks at session end, `ffmpeg -f concat -c copy` (clips share codec/size/fps), uploads to object storage, writes the URL back via a new worker-only reducer/table (e.g. `set_session_compilation_url`). Needs a worker view over `session_clip_chunk` and a hosting choice (`product/decisions.md`).
- Phone sensor page (`phone/`, optional), replay clips (local-only replay screen; the old `replay_clip_meta` is unused).
- Screens: replay (no consent screen by decision; see `product/privacy.md`).
- Worker: summary + replay captions.
- Inferentia small model (Claude Haiku is the only judge).
- Integrations: Creao/Slack, Notability export.

## UI features still to integrate (spec: `ui_integration.md`)
Done against the DB: session create/join, Pomodoro sync (lobby `set_pomodoro` → `start_session` → server clock), teammates list (members + status), goals + `check_goal`, leave.
| Feature | Needs |
|---|---|
| Off-task detection → DB | Done for the verdict: detector → `wyd:detector-status` → `ingest_signal` (`App.tsx`). Still to send: real webcam/activity fields (`architecture/contracts.md#signalinput`). |
| Off-task → check-in | Drive the overlay check-in from `my_alerts` (`CallIncoming`) / `my_session_group_calls` + `respond_to_call`/`end_call`, replacing the Demo menu |
| "I'm tired" signal | Local only; no matching reducer (new contract item) |
| Avatar | Name input done (`set_profile`); avatar color fixed `#7C8CF8` |
| Break / goal check-in | Show `GoalCheckin` alerts + `mark_alert_delivered`; long (20 min) break not supported by module (one `pomodoro_break_secs`) |
| Summary extras | Summary shows real stats from `my_session_summaries`; awards, scores, Claude recap (worker `set_summary_text`) not shown |
| Host leave | Module moves `is_host` to the lowest-id active member; UI shows no notice |
| Overlay direct DB feed | Currently relayed through `App.tsx` |
| Worker | Subscribe `worker_pending_signal_events`, `write_judgment`; hosting undecided (see `product/decisions.md`) |
| Camera-on disclosure | Dock shows Camera on/off (follows tracking); no extra disclosure UI |

## Mismatches (unresolved; decisions tracked in `product/decisions.md`)
| Area | Variants in code |
|---|---|
| Judge | `src/main/claudeJudge.ts`: `claude-haiku-4-5-20251001`, labels `productive`/`distracted`/`neutral` · `worker/judge.ts`: `claude-haiku-5-5`, `on_task`/`off_task`/`break` · DB `StatusLabel`: `Focused`/`OffTask`/`Away`/`Break`/`Unknown` |
| Categories | `categorize.ts`: contract lowercase 9 · `appClassifier.ts`: `productive`/`distracted`/`neutral`/`unknown` (drives alerts) · DB `AppCategory`: `OnTask`/`OffTask` (published 2026-10-24). Desktop sets still to be replaced by the OCR + Gemini verdict (`architecture/overview.md#off-task-pipeline`). |
| Event format | Contract JSON (`worker/types.ts`) vs DB `SignalInput`. See `architecture/contracts.md`. |
| Timing | Spec: drift 2 min, call cooldown 30 min, call ~60 s · DB: call immediately on OffTask (`off_task_threshold_secs` 0), cooldown 600 s, max call 90 s · Desktop: alerts at 30/60 s, auto-call cooldown 5 min, LiveKit call 30 s |
| Calls | LiveKit: call state in participant attributes, triggered by the local detector (`face time`) · DB: `group_call` + `CallIncoming` alert (also created by `ingest_signal`), `call_room_base_url` `""`. Not linked; the UI ignores DB calls. |
| Active window | Old docs said `get-windows`; code uses `osascript`. |
| Scope | DB has scores, awards, takeover, stuck-helper, DeepFace expression fields, `factory_run_id`; decisions lean against several. |
| SDK | `@anthropic-ai/sdk ^0.27` (old); worker casts around missing `output_config` type. |

## Next up (demo critical path, suggested)
1. Click-through test of the DB-backed UI (two instances, separate `--user-data-dir`); then `ingest_signal` from `activityMonitor` every 10 s. Feed the `face time` trigger into it (today it only opens the local LiveKit check-in).
2. Worker subscribes to `worker_pending_signal_events` → `write_judgment`. (DB fallback judge covers the demo meanwhile.)
3. Wire LiveKit into the new UI's check-in windows; start the call from the DB `CallIncoming` alert instead of the local desktop alert.
4. Back summary screen with real stats.
5. Resolve judge + category mismatches.

## Gotchas
- 2026-10-24: `session_clip` / `session_clip_chunk` / clip reducers are **not published to maincloud yet** (additive publish, data kept; bindings already regenerated). Until then clip uploads fail with an "unknown reducer" error and are dropped (logged `[clip] upload failed`).- 2026-10-24: module published to maincloud with `--delete-data=on-conflict` (data wiped; `init` re-seeded 12 settings): removed `member.joined_at`, `session.host_identity`; added `active_connection`, `CallEndedReason.Superseded`. Client bindings regenerated.
- 2026-10-24: db wiped + republished (`--delete-data=on-conflict`) for the binary `AppCategory`; `seed_defaults` re-run. Any old session/token state is gone (identities persist per client token).
- `set_pomodoro` published to maincloud 2026-10-24 (additive publish, data kept).
- 2026-10-25: module published to maincloud (additive, data kept): `take_break`, `stop_pomodoro`, unlocked `set_pomodoro`, `disconnect_timer` reaper, `create_session(code?)`. Bindings are generated (no hand-added files).
- Desktop DB client: `src/main/db/stdb.ts` (single connection in main; Node 18 needs `undici` for WebSocket). Renderer reads `window.wydDesktop.db` (`snapshot`, `call`, `onState`) via `src/renderer/src/db/useDb.ts`. Offline/not connected → entry screen falls back to the local demo flow (needs a typed code).
- Regenerate bindings after any module change: `spacetime generate --lang typescript --module-path spacetimedb --out-dir src/main/db/module_bindings -y`.
- Breaking schema changes need `spacetime publish calhacks-13-wyd --delete-data=on-conflict -y` (wipes data). Fresh db: `init` seeds defaults; existing db: run `seed_defaults`. Consent columns removed; republished 2026-10-24, db identity `c200f3d8…1bc7`.
- `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` unless `vite` is an explicit devDependency (added). Used `--legacy-peer-deps` to add Tailwind.
- Renderer CSS imports Google Fonts: needs network. No CSP is set (old UI had none; `ui_to_integrate` CSP omitted because it blocks LiveKit/SpacetimeDB sockets).
- `ui_to_integrate/` is the untouched UI source; safe to delete once the team confirms.
- Every laptop needs `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env`; each signs its own call token.
- LiveKit tokens are signed by hand in `livekitToken.ts`: `livekit-server-sdk` needs Node 19+, Electron 28 ships Node 18.
- Worker runs `.ts` directly: needs Node 24 (`node -v`).
- `osascript` needs Accessibility/Automation permission for System Events; window titles need Screen Recording. Screen monitor OCR also needs Screen Recording. `GEMINI_API_KEY` for `vision/04_screen_monitor.py`.
- A Gemini key was hardcoded on `origin/prod` and `origin/webcam-activity-detection`; removed (prod `eebfad3`), replaced in `.env`, but still in git history. Never commit keys.
- Facetime trigger: `npm run setup:vision` once so `vision/.venv` exists. Prints `face time` when the screen is off-task twice in a row, or when the screen is on-task both times and the webcam is distracted both times. Video check-in popups stay on the Demo menu (`OverlayApp.tsx`: `.glass-video`, `.checkin-timer-pop`, `.teammate-share-window`).
- SpacetimeDB `init` seeds only on first publish; after a schema publish run `seed_defaults`.

Kevin-specific (his machine/setup only):
- Node v20.19.5 installed; worker needs Node 24, so `npm run fixtures` likely fails until upgraded.
- Empty untracked `desktop/src/` folder at root; desktop code lives in `src/`.

## Reorganize procedure
When asked to "reorganize" (or "update the docs"), Claude:
1. **Re-scan the code** (`package.json` files, `src/`, `spacetimedb/src/`, `worker/`, any new top-level folder) and rewrite Built / Stubbed / Missing / Mismatches / Gotchas above to match what the code does today. Update "Last updated".
2. **Update architecture docs** if anything changed:
   - `architecture/stack.md`: versions, env vars, commands
   - `architecture/contracts.md`: event fields, enums, IPC channels, reducer signatures
   - `architecture/overview.md`: diagram and data flow
3. **Create or update `docs/components/<name>.md`** for every part with real code (e.g. desktop, worker, vision, phone, call). Skip parts that are only planned; list them under Missing. Headings: Purpose · Files · Inputs/Outputs (link to contracts.md) · Run & test · Current state · Gotchas & don'ts.
4. **Move resolved items** in `product/decisions.md` from Open to Decided, with date.
5. **Consolidate.** Apply the "Writing docs" rules in `CLAUDE.md` to every doc touched: merge duplicates, remove stale or redundant text, convert prose to tables/lists, replace repeated content with links. Report rough before/after size.
6. **Never edit** `product/vision.md`, `spec.md`, `privacy.md` unless asked; those are team decisions, not code facts.
7. **Report** what changed, plus any contract changes needing the team's attention.
