# Status

Last updated: 2026-10-24. Biggest gap: desktop connects to SpacetimeDB (`src/main/db/stdb.ts`) but sends no `ingest_signal`; the worker is not wired to the DB; most UI data is hardcoded/local.

## Built
| Part | Path | What works |
|---|---|---|
| SpacetimeDB module | `spacetimedb/` | Full schema + ~40 reducers: sessions, goals, Pomodoro timers, `ingest_signal`, smoothing, fallback judge, scoring, call/nudge trigger, phone pairing, finalize + awards. Configured for maincloud db `calhacks-13-wyd`. See `components/spacetimedb.md`. |
| Desktop activity tracking | `src/main/activityMonitor.ts` | Polls front app + window title + browser URL (Chrome/Safari/Arc/Brave) every 2 s via `osascript`. macOS only. |
| Distraction trigger | `vision/facetime_trigger.py`, `vision/detector.py`, `vision/04_screen_monitor.py`, `src/main/facetimeTrigger.ts` | Goals submit starts both detectors. Screen off-task twice in a row, or screen on-task twice with webcam distracted both times, prints `face time`. See `components/vision.md`. |
| Desktop `.env` loader | `src/main/env.ts` | Loads root `.env` into `process.env` at startup (no override of shell vars). |
| Desktop categorization | `src/main/categorize.ts` | Rules + cache → contract categories (`coding`…`unknown`). Fills `activity.category`. |
| Desktop judge | `src/main/claudeJudge.ts` | Claude call every 8 s once session context exists; output drives local alerts (30 s warning, 60 s alert). |
| Check-in calls (LiveKit) | `src/main/livekitToken.ts`, `src/renderer/src/useCircleCall.ts` (old UI in `outdated/`: `VideoCall.tsx`) | One LiveKit room per session code: presence, 90 s video call, late joiners auto-join. Worked in the old UI; **unwired** in the new UI. See `components/livekit-call.md`. |
| Desktop UI | `src/renderer/src/` (+ `docs/ui_integration.md`) · dock + check-ins in full-screen overlay window (`overlay/OverlayApp.tsx`) | New Figma-Make UI: entry, intro, goals, focus workspace, dock, check-in windows, break, summary. All data hardcoded/local; Demo menu simulates events. Goals submit calls `wyd:tracking:start`. |
| Worker judge | `worker/judge.ts` | Text-only judge over 2-min window → `{status, confidence, reason}`; failure → confidence 0 (neutral). |
| Worker categorizer | `worker/categorizeUnknown.ts` | Model categorization for `unknown` titles, cached. |
| Worker fixtures | `worker/runFixtures.ts` | 15 scenarios, `npm run fixtures`. |

## Stubbed
- Voice AI onboarding: archived in `outdated/` (see `outdated/README.md`); goals now come from the Goals screen.
- LiveKit calls: `circleAPI` preload + `useCircleCall.ts` exist but nothing in the new UI uses them. **Important next step:** replace the UI's placeholder check-in tiles with real LiveKit video (see `components/livekit-call.md`).
- Call room: `call_room_base_url` setting is `""`; no provider chosen.

## Missing
- UI wiring: `activity:update`/`activity:alert` not consumed (UI uses Demo-menu triggers); summary stats (see `ui_integration.md` demo-only inventory).
- Desktop → SpacetimeDB: no `ingest_signal` calls yet; no UI for `my_alerts`, group calls, takeover, phone pairing, stuck, summaries/awards; no display-name input (`set_profile` unused, users show as `guest-xxxx`).
- Pause/stop for everyone: no reducer exists (host console Stop is a no-op in a DB session).
- Overlay window gets DB state only via `App.tsx` → `OverlayState`; it has no direct DB feed.
- Worker ↔ SpacetimeDB: no subscription to `worker_pending_signal_events`, no `write_judgment`.
- Phone sensor page (`phone/`, optional), replay clips. Distraction trigger prints `face time` only; it does not open the check-in popups.
- Check-in call UI.
- Screens: replay (no consent screen by decision; see `product/privacy.md`).
- Worker: summary + replay captions.
- Inferentia small model (Claude Haiku is the only judge).
- Integrations: Creao/Slack, Notability export.

## UI features still to integrate (UI is hardcoded/local; spec: `ui_integration.md`)
| Feature | Needs |
|---|---|
| Session create/join | Real invite codes + room lookup (SpacetimeDB sessions); host/participant role from server membership. `STUDY25` is hardcoded. |
| Pomodoro sync | Host publishes `PomodoroTimerEvent`; participants derive time from `startedAt`. Reducers exist; no client. |
| Teammates / focus dots | `people.ts` is hardcoded; use session members + smoothed status. |
| Off-task detection → check-in | Replace Demo menu with `activity:update`/`alert` + DB call trigger (`CallIncoming`). |
| Check-in video | Wire LiveKit (`useCircleCall.ts`, `circleAPI`) into placeholder tiles. **Important.** |
| Screen share in check-in | Hardcoded calculus mock; use `desktopCapturer` source. |
| "I'm tired" signal | Local only; send `ParticipantFatigueSignal`; host reads. |
| Leave / host leave | Presence update; host leave policy (end room vs transfer) undecided. |
| Goals / distraction capture | Local React state; persist as session records (private). |
| Private summary | Hardcoded %, minutes, rhythm chart; compute from session records; Claude summary (1 call/session). |
| Camera-on disclosure / vision | MediaPipe not built. |
| Phone sensor, replay clips | Not built. |
| Overlay polish | Overlay covers one display (the main window's work area, below the menu bar); no multi-display. Overlay window is hidden, not destroyed, outside focus. |
| Demo menu | Hide behind dev flag for final build. |
| Voice AI | Archived in `outdated/`; re-add only if wanted. |

## Mismatches (unresolved; decisions tracked in `product/decisions.md`)
| Area | Variants in code |
|---|---|
| Judge | `src/main/claudeJudge.ts`: `claude-haiku-4-5-20251001`, labels `productive`/`distracted`/`neutral` · `worker/judge.ts`: `claude-haiku-5-5`, `on_task`/`off_task`/`break` · DB `StatusLabel`: `Focused`/`OffTask`/`Away`/`Break`/`Unknown` |
| Categories | `categorize.ts`: contract lowercase 9 · `appClassifier.ts`: `productive`/`distracted`/`neutral`/`unknown` (still drives alerts) · DB `AppCategory`: `Work`/`Study`/`Communication`/`Social`/`Entertainment`/`Games`/`News`/`Other` |
| Event format | Contract JSON (`worker/types.ts`) vs DB `SignalInput`. See `architecture/contracts.md`. |
| Timing | Spec: drift 2 min, call cooldown 30 min, call ~60 s · DB: call at ~60 s off-task (`off_task_threshold_secs`), cooldown 600 s, max call 90 s · Desktop: alerts at 30/60 s, auto-call cooldown 5 min, LiveKit call 90 s |
| Calls | LiveKit: call state in participant attributes, triggered by desktop alert · DB: `group_call` + `CallIncoming` alert, `call_room_base_url` `""`. Not linked. |
| Active window | Old docs said `get-windows`; code uses `osascript`. |
| Scope | DB has scores, awards, takeover, stuck-helper, DeepFace expression fields, `factory_run_id`; decisions lean against several. |
| SDK | `@anthropic-ai/sdk ^0.27` (old); worker casts around missing `output_config` type. |

## Next up (demo critical path, suggested)
1. Desktop sends `ingest_signal` every 10 s (client + session join exist). Feed the `face time` trigger into it / the check-in call.
2. Worker subscribes to `worker_pending_signal_events` → `write_judgment`. (DB fallback judge covers the demo meanwhile.)
3. Wire LiveKit into the new UI's check-in windows; start the call from the DB `CallIncoming` alert instead of the local desktop alert.
4. Back summary screen with real stats.
5. Resolve judge + category mismatches.

## Gotchas
- `set_pomodoro` published to maincloud 2026-10-24 (additive publish, data kept).
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
