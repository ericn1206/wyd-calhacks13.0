# Status

Last updated: 2026-10-25 (session clips + clip compiler). Biggest gap: only the detector's OnTask/OffTask verdict reaches SpacetimeDB (`ingest_signal` from `App.tsx`, every 5 s while Active/Break); webcam/activity fields are sent neutral. Session create/join, goals, lobby roster, shared Pomodoro timer work against maincloud. Worker runs without the DB.

## Built
| Part | Path | What works |
|---|---|---|
| SpacetimeDB module | `spacetimedb/` | Full schema + 40 reducers: sessions, goals, Pomodoro timers, `ingest_signal`, smoothing, fallback judge, scoring, call/nudge trigger, phone pairing, finalize + awards. Configured for maincloud db `calhacks-13-wyd`. See `components/spacetimedb.md`. |
| Desktop activity tracking | `src/main/activityMonitor.ts` | Polls front app + window title + browser URL (Chrome/Safari/Arc/Brave) every 2 s via `osascript`. macOS only. |
| Distraction trigger | `vision/facetime_trigger.py`, `vision/detector.py`, `vision/04_screen_monitor.py`, `src/main/facetimeTrigger.ts` | Runs only while a round timer is going. Every 5 s Gemini judges the OCR text (front app and named sites are context, not a block; planning tools count as on task). Off twice in a row, or webcam distracted twice while the screen looks on-task, prints `face time`. See `components/vision.md`. |
| Desktop `.env` loader | `src/main/env.ts` | Loads root `.env` into `process.env` at startup (no override of shell vars). |
| Desktop categorization | `src/main/categorize.ts` | Rules + cache → contract categories (`coding`…`unknown`). Fills `activity.category`. |
| Desktop judge | `src/main/claudeJudge.ts` | Gemini `gemini-3.5-flash-lite` every 8 s once session context exists. Strict: a different subject is distracted. Spoken goals are condensed to short titles. Output drives local alerts (30 s warning, 60 s alert). The dock pill uses the vision detector reason, not this judge. |
| Check-in calls (LiveKit) | `src/main/livekitToken.ts`, `src/renderer/src/useCircleCall.ts` (old UI in `outdated/`: `VideoCall.tsx`) | Detector `face time` → own 30 s call with camera + screen share (overlay hidden from the capture); teammates get a 3 s Join invite and see the share window; alone → duck window with Resume. See `components/livekit-call.md`. |
| Break room | `components/session/BreakRoom.tsx`, `useCircleCall.ts` (`kind: 'break'`) | DB-session break screen auto-joins room `lockin-<CODE>-break`; everyone's video shown. Typechecks; not click-tested with two laptops. See `components/livekit-call.md#break-room`. |
| Detector debug + status sync | `vision/facetime_trigger.py` (`status`/`debug` lines), `src/main/facetimeTrigger.ts`, `components/session/DetectorLog.tsx` | Verdict → `ingest_signal` → status dots on every screen. Dock pill shows `On task`/`Off task: <screenshot one-liner>`. Demo menu: dock debug strip (includes current app) + detector log (last 300). Idle / Camera off outside a running round. See `components/vision.md`. |
| Desktop UI | `src/renderer/src/` (+ `docs/ui_integration.md`) · dock + check-ins in full-screen overlay window (`overlay/OverlayApp.tsx`) | New Figma-Make UI: entry, intro, one-question goals ("What do you want to do?"), focus workspace, dock, check-in windows, break, summary. Demo menu simulates events. That sentence is the goal passed to `wyd:tracking:start`. Pomodoro "Add goal" box (`saveDistraction` in `App.tsx`) appends a goal (max 3): `set_goals` (replaces rows, completions re-checked after) + restarts tracking so the detector/judge get the new goals. |
| Desktop DB client | `src/main/db/stdb.ts`, `src/renderer/src/db/useDb.ts` | Single main-process connection; token persisted; create/join session, `set_pomodoro`, `start_session`, shared timer + phase flip to break, goals + `check_goal`, roster, `leave_session`. Verified headless with 2 clients 2026-10-24; UI click-through untested. Debug log: see `architecture/stack.md` (`WYD_DEBUG`). |
| Session clips | `vision/clip_recorder.py`, `vision/screen_capture.py`, `vision/detector.py`, `src/main/clipUpload.ts`, `session_clip*` in `spacetimedb/` | Check-in (`face time`, DB session live) → 30 s clip (10 s before, 20 s after) of the drifter's screen (WYD windows excluded) with webcam inset, 1280×720, recorded on their laptop → chunked upload as soon as recorded, tied to session + unfocused member. Real clips from the app uploaded and compiled on maincloud 2026-10-25 (webcam-only, 320×240). Screen + inset version verified against the real window server with a synthetic webcam; not yet run with the real camera in the app. Camera = the one the LiveKit call uses (`WYD_CAMERA_LABEL`, `components/vision.md`); untested in the app. Needs Screen Recording permission (else webcam only). Tests: `npm run test:clips` (`tests/session-clips/README.md`). See `architecture/contracts.md#session-clips`. |
| Clip compiler | `worker/compile/`, `session_compilation` | Local Node process (`npm run clips:host`, or `npm run worker:compile`; one per database, enforced by a lease in the db): subscribes as a worker identity, joins an ended session's clips with ffmpeg, hosts the mp4 itself, writes the URL to the db. Late clips re-render. Verified 2026-10-25 end to end on a local db (`tests/session-clips`). Docs: `components/clip-compiler.md`. |
| Worker judge | `worker/judge.ts` | Text-only judge over 2-min window → `{status, confidence, reason}`; failure → confidence 0 (neutral). |
| Worker categorizer | `worker/categorizeUnknown.ts` | Model categorization for `unknown` titles, cached. |
| Worker fixtures | `worker/runFixtures.ts` | 15 scenarios, `npm run fixtures`. |

## Stubbed
- Voice AI onboarding: prod's `VoiceScreen.tsx` / `cartesiaCall.ts` / `session:*` IPC are merged but unrouted (voice off for now, `product/decisions.md`); goals come from the Goals screen.
- Call room: `call_room_base_url` setting is `""`; no provider chosen.

## Missing
- UI wiring still open: see table below (activity fields → DB, check-in from alerts). `activity:update` feeds the dock debug strip's current app. `activity:alert` is not consumed.
- Off-task pipeline: local OCR + Gemini classification → `ingest_signal` (`architecture/overview.md#off-task-pipeline`). Replaces desktop `categorize.ts`/`appClassifier.ts`/`claudeJudge.ts` as the verdict source.
- Pomodoro: in a DB session all clocks/screens derive from the server (`components/spacetimedb.md#behavior`, skew-corrected); the local timer, `finishPomodoro`, break countdown and "Back to focus" exist only in the offline demo flow.
- Pause: decided against. Host has `take_break` (force a break now, work round only) and `end_session`; the DB-session dock shows Start (lobby) + Take a break only.
- Session lifecycle (published to maincloud, additive): resume after restart, ended session → summary with real stats, host End session, 60 s disconnect reaper (`disconnect_timer`), name input (`set_profile`). Module verified via CLI on a scratch db; UI click-through untested.
- Worker ↔ SpacetimeDB: no subscription to `worker_pending_signal_events`, no `write_judgment`.
- Summary screen shows a "Session highlights" card (link to `<clip server>/session/<id>`, copy button) once a compiler has published its address; not click-tested in the app. Needs `set_clip_page_base_url` published to maincloud (not yet) and the compiler running.
- Phone sensor page (`phone/`, optional), replay clips (local-only replay screen; the old `replay_clip_meta` is unused).
- Screens: replay (no consent screen by decision; see `product/privacy.md`).
- Worker: summary + replay captions.
- Inferentia small model. Desktop and worker judges are Gemini `gemini-3.5-flash-lite`.
- Integrations: Creao/Slack, Notability export.

## UI features still to integrate (spec: `ui_integration.md`)
Done against the DB: session create/join, Pomodoro sync (lobby `set_pomodoro` → `start_session` → server clock), teammates list (members + status), goals + `check_goal`, leave.
| Feature | Needs |
|---|---|
| Off-task detection → DB | Done for the verdict: detector → `wyd:detector-status` → `ingest_signal` (`App.tsx`). Still to send: real webcam/activity fields (`architecture/contracts.md#signalinput`). |
| Off-task → check-in | Drive the overlay check-in from `my_alerts` (`CallIncoming`) / `my_session_group_calls` + `respond_to_call`/`end_call`, replacing the Demo menu |
| "I'm tired" signal | Local only; no matching reducer (new contract item) |
| Avatar | Name input done (`set_profile`); avatar color fixed `#7C8CF8` |
| Break / goal check-in | Show `GoalCheckin` alerts + `mark_alert_delivered` |
| Summary extras | Summary shows real stats from `my_session_summaries`; awards, scores, Claude recap (worker `set_summary_text`) not shown |
| Host leave | Module moves `is_host` to the lowest-id active member; UI shows no notice |
| Overlay direct DB feed | Currently relayed through `App.tsx` |
| Worker | Subscribe `worker_pending_signal_events`, `write_judgment`; hosting undecided (see `product/decisions.md`) |
| Camera-on disclosure | Dock shows Camera on/off (follows tracking); no extra disclosure UI |

## Mismatches (unresolved; decisions tracked in `product/decisions.md`)
| Area | Variants in code |
|---|---|
| Judge | `src/main/claudeJudge.ts`: `gemini-3.5-flash-lite`, labels `productive`/`distracted`/`neutral` · `worker/judge.ts`: same model via `worker/claude.ts`, labels `on_task`/`off_task`/`break` · DB `StatusLabel`: `Focused`/`OffTask`/`Away`/`Break`/`Idle` |
| Categories | `categorize.ts`: contract lowercase 9 · `appClassifier.ts`: `productive`/`distracted`/`neutral`/`unknown` (drives alerts) · DB `AppCategory`: `OnTask`/`OffTask` (published 2026-10-24). Desktop sets still to be replaced by the OCR + Gemini verdict (`architecture/overview.md#off-task-pipeline`). |
| Event format | Contract JSON (`worker/types.ts`) vs DB `SignalInput`. See `architecture/contracts.md`. |
| Timing | Spec: drift 2 min, call cooldown 30 min, call ~60 s · DB: call immediately on OffTask (`off_task_threshold_secs` 0), cooldown 600 s, max call 90 s · Desktop: alerts at 30/60 s, auto-call cooldown 5 min, LiveKit call 30 s |
| Calls | LiveKit: call state in participant attributes, triggered by the local detector (`face time`) · DB: `group_call` + `CallIncoming` alert (also created by `ingest_signal`), `call_room_base_url` `""`. Not linked; the UI ignores DB calls. |
| Active window | Old docs said `get-windows`; code uses `osascript`. |
| Scope | DB has scores, awards, takeover, stuck-helper, DeepFace expression fields, `factory_run_id`; decisions lean against several. |
| SDK | `@anthropic-ai/sdk ^0.27` is still a dependency; desktop and worker judges call Gemini over `fetch` and do not import it. |

## Next up (demo critical path, suggested)
1. Click-through test of the DB-backed UI (two instances, separate `--user-data-dir`); then `ingest_signal` from `activityMonitor` every 10 s. Feed the `face time` trigger into it (today it only opens the local LiveKit check-in).
2. Worker subscribes to `worker_pending_signal_events` → `write_judgment`. (DB fallback judge covers the demo meanwhile.)
3. Start the LiveKit check-in from the DB `CallIncoming` alert instead of the local `face time` line.
4. Back summary screen with real stats.
5. Resolve judge + category mismatches.

## Gotchas
- 2026-10-25: clips lost when tracking stops <20 s after a check-in (break/end session): `facetime_trigger.py` terminates the detector only after its current interval ends, but its watchdog hard-exits after `STOP_GRACE_SEC` 4 s, so the detector never flushes. Not fixed. Trace with `[clipdbg]` (python stderr: recorder/detector/trigger) and `[clip]` (Electron main) log lines; healthy order: `requested` → `forwarding to detector` → `writing` → `wrote` → `relaying detector reply` → `detector reply` → `uploading` → `uploaded`.
- 2026-10-25: compilation videos live in the compiler's folder, but the database says Ready. The lease holder now rebuilds any Ready row whose file is missing (new machine, wiped folder), and `session_compilation.url` is a path without a host, so a changed IP does not break it. Old rows with a full address keep working while that host is up. See `components/clip-compiler.md`.
- 2026-10-25: **Publishing this branch's module to maincloud now needs `--delete-data=on-conflict` (wipes all data: sessions, clips, compilations).** The merged `idle-status` branch renames `StatusLabel` `Unknown` → `Idle` in `status`/`judgment` columns, which SpacetimeDB treats as a breaking change. Plain `spacetime publish` (additive) aborts. The clip changes themselves (`compiler_lease`, views, limits) are additive; only the merged rename is breaking. Decide before publishing.
- 2026-10-25: one clip compiler per database. It takes a lease row (`compiler_lease`) before starting: a second one exits with `a clip compiler is already running: <host>` unless started with `-- --takeover`; the lease goes stale after 20 s without heartbeat. The lease reducers are not on maincloud until the module is published (until then `clips:host` / `worker:compile` fail at start with an unknown-reducer error).
- 2026-10-25: the detector/trigger no longer outlive the app (an orphaned `facetime_trigger.py` kept the camera and screen capture running after the app quit): the trigger stops on SIGTERM or when Electron's pipe closes, with a 4 s watchdog that kills the detector; Electron adds a 6 s SIGKILL backstop. Screen Recording permission is checked up front (`CGPreflightScreenCaptureAccess`): without it clips are webcam only and stderr says why, instead of recording wallpaper. An unreadable clip is left out of the compilation instead of failing it.
- 2026-10-25: `/session/<id>` said "waiting for the session to end" forever for a session that never produced a clip (the 40 s two-window test: Gemini calls failed with `Connection aborted`, screen votes were `unknown`, the check-in never fired, so no clip). The page now says "no highlights" (`empty`) once the session has ended without clips (needs `worker_ended_sessions` published to maincloud). A flaky network to Gemini (VPN) also breaks the check-in trigger, because any `unknown` vote resets the streak.
- 2026-10-25: clip limits in the module were raised (64 MiB, 400 chunks) for 1280×720 clips; **not published to maincloud yet**. Typical clips (1–6 MB) fit the old limits (12 MiB, 64 chunks), so uploads work until then.
- Clip screen capture: macOS Screen Recording permission for the app that launches Electron (Terminal/VS Code in dev), same as the OCR. Without it clips show only the desktop wallpaper behind the windows; if capture fails 20× in a row the detector logs `clips will be webcam only`. Clips record whatever is on screen (secrets in an editor included); `product/privacy.md`.
- 2026-10-25: module published to maincloud (additive, data kept): `session_clip`, `session_clip_chunk`, `session_compilation`, clip reducers, `set_session_compilation`, `my_session_clips`, `my_session_compilations`, `worker_*` clip views. The compiler's identity must be an authorized worker (`components/clip-compiler.md#run`). Compilation URLs default to `localhost`: set `COMPILE_PUBLIC_URL` to the LAN IP for other laptops.
- macOS overlay: `type: 'panel'` (clicks don't activate the app / raise the main window) and `setVisibleOnAllWorkspaces(..., { skipTransformProcessType: true })` (without it Electron makes the app a UI-element process and its Dock icon disappears).
- 2026-10-24: module published to maincloud with `--delete-data=on-conflict` (data wiped; `init` re-seeded 12 settings): removed `member.joined_at`, `session.host_identity`; added `active_connection`, `CallEndedReason.Superseded`. Client bindings regenerated.
- `StatusLabel.Unknown` → `Idle` (enum change): module not yet republished. Run `spacetime publish calhacks-13-wyd --delete-data=on-conflict -y` (wipes data) then `seed_defaults`, and regenerate bindings (`types.ts` was hand-edited to match). Tell the team.
- 2026-10-24: db wiped + republished (`--delete-data=on-conflict`) for the binary `AppCategory`; `seed_defaults` re-run. Any old session/token state is gone (identities persist per client token).
- `set_pomodoro` published to maincloud 2026-10-24 (additive publish, data kept).
- Module published to maincloud (additive, data kept): `take_break`, `stop_pomodoro`, unlocked `set_pomodoro`, `disconnect_timer` reaper, `create_session(code?)`. Bindings are generated (no hand-added files).
- Desktop DB client: `src/main/db/stdb.ts` (single connection in main; Node 18 needs `undici` for WebSocket). Renderer reads `window.wydDesktop.db` (`snapshot`, `call`, `onState`) via `src/renderer/src/db/useDb.ts`. Offline/not connected → entry screen falls back to the local demo flow (needs a typed code).
- Regenerate bindings after any module change: `spacetime generate --lang typescript --module-path spacetimedb --out-dir src/main/db/module_bindings -y`.
- Breaking schema changes need `spacetime publish calhacks-13-wyd --delete-data=on-conflict -y` (wipes data). Fresh db: `init` seeds defaults; existing db: run `seed_defaults`. Consent columns removed; republished 2026-10-24, db identity `c200f3d8…1bc7`.
- `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` unless `vite` is an explicit devDependency (added). Used `--legacy-peer-deps` to add Tailwind.
- Renderer CSS imports Google Fonts: needs network. No CSP is set (a CSP would block LiveKit/SpacetimeDB sockets).
- Every laptop needs `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env`; each signs its own call token.
- LiveKit tokens are signed by hand in `livekitToken.ts`: `livekit-server-sdk` needs Node 19+, Electron 28 ships Node 18.
- Worker runs `.ts` directly: needs Node 24 (`node -v`).
- `osascript` needs Accessibility/Automation permission for System Events; window titles need Screen Recording. Screen monitor OCR also needs Screen Recording. `GEMINI_API_KEY` for `vision/04_screen_monitor.py`, `src/main/claudeJudge.ts`, and `worker/claude.ts`.
- A Gemini key was hardcoded on `origin/prod` and `origin/webcam-activity-detection`; removed (prod `eebfad3`), replaced in `.env`, but still in git history. Never commit keys.
- Facetime trigger: `npm run setup:vision` once so `vision/.venv` exists. Every 5 s Gemini judges the OCR text (front app and named sites are context). Two off-task hits, or two on-task intervals with the webcam distracted, print `face time` and open the live check-in. The Demo menu still opens the mock one.
- SpacetimeDB `init` seeds only on first publish; after a schema publish run `seed_defaults`.

Kevin-specific (his machine/setup only):
- Node v20.19.5 installed; worker needs Node 24, so `npm run fixtures` likely fails until upgraded.

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
