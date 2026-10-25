# Clip compiler

Purpose: after a session ends, join its clips (`session_clip`, `contracts.md#session-clips`) into one video, host it, and publish the URL in `session_compilation`. Clips stay in SpacetimeDB. Runs as a local Node process during dev/testing.

## Files
| Path | Role |
|---|---|
| `worker/compile/main.ts` | Entry: env → `startCompiler` |
| `worker/compile/compiler.ts` | Subscribes as a worker identity, decides, renders, reports (`setSessionCompilation`) |
| `worker/compile/plan.ts` | Pure: `orderClips`, `dueSessions`, `videoName`, `staleVideos` |
| `worker/compile/render.ts` | ffmpeg join (`ffmpegArgs`, `renderCompilation`) |
| `worker/compile/serve.ts` | HTTP: `GET /compilations/session-<id>-<n>.mp4` (Range, CORS `*`), `GET /session/<id>` (shareable page), `GET /session/<id>/status` (JSON), `GET /health` |
| `worker/compile/page.ts` | The `/session/<id>` HTML (polls `/status` every 3 s: waiting → rendering → video) and the status JSON shape |
| `worker/compile/run.mjs` | Bundles `main.ts` with esbuild (bindings are TS Node can't run) and runs it |

## Flow
```
end_session → session Ended → worker_ended_sessions / worker_session_clips / worker_session_clip_chunks (worker-only views)
worker: wait COMPILE_QUIET_SECS since the last change (clips of the last 20 s arrive after the end) and all chunks held
  → setSessionCompilation(Rendering) → ffmpeg → worker/out/compilations/session-<id>-<n>.mp4
  → setSessionCompilation(Ready, clipCount n, url) → members read it from my_session_compilations (desktop snapshot key `compilations`)
```
- Views list only sessions whose complete clips are not already in a `Ready` compilation of the same `clipCount`: a late clip makes the session reappear, it is re-rendered to a new file name (`-<n>`), and older files of that session are deleted.
- Order: `momentAtMs`, then clip id. Output: 1280×720, 10 fps, H.264 (crf 20), faststart, no audio. Each input is fitted into the frame (letterboxed, never stretched) and joined with ffmpeg's concat filter (older 320×240 webcam-only clips, mixed size/codec are fine).
- `Failed` → error text in the row; retried after 60 s.
- Connection: drops are logged (`disconnected; reconnecting`) and retried with backoff 2 s → 30 s; the page reports `offline` meanwhile. Every database call has a 20 s timeout (a call on a dropped connection never answers and would otherwise block the worker).
- `worker_ended_sessions` lists **every** ended session (not only ones needing a render), so `empty` can be told apart from `waiting`. Needs the module published to maincloud (2026-10-25 change); before that, sessions with no clips stay `waiting`.

## Shareable link
Summary screen: the desktop builds `<base>/session/<session.id>` itself. `<base>` = `app_setting` `clip_page_base_url`, which the compiler writes on every start (`set_clip_page_base_url(url)`, worker-only, http(s) only) from `COMPILE_PUBLIC_URL`; the card's state (waiting/rendering/ready/failed) comes from `my_session_compilations`. Code: `useDb.ts` `clipInfo`, `SummaryScreen.tsx` `HighlightCard`. No card until a compiler has published its address (the video `url` itself is in `session_compilation`, but the page link must exist before that row does).

`<COMPILE_PUBLIC_URL>/session/<session id>` works before the session ends: it shows "waiting for the session to end", then "putting your clips together", then the video, without a reload. Status JSON: `{state: waiting|rendering|ready|failed|empty|offline, clipCount?, video?, error?}`. `waiting` = session not ended (or unknown id); `rendering` = ended with clips, being joined; `empty` = ended and no clip was saved (a clip is recorded only when a check-in fires; reported after the quiet period + 20 s, flips to `rendering` if a late clip arrives); `offline` = the worker lost its database connection and is reconnecting. The id is `session.id` (`tables.sessions[].id` in the desktop snapshot). The page is served by this process, so it only loads while it runs.

## Run
1. `brew install ffmpeg` (needs `ffmpeg` on PATH or `FFMPEG_BIN`).
2. Worker identity: the identity that published the db is already a worker. Either put its token in `WYD_WORKER_TOKEN` (`spacetimedb_token` in `~/.config/spacetime/cli.toml`), or start once, then run the `spacetime call … authorize_worker '"0x<identity>"'` line it prints. The token is saved in `worker/.state/compile-token`.
3. `npm run worker:compile`.

| Env | Default | Meaning |
|---|---|---|
| `SPACETIME_URI`, `SPACETIME_DB` | maincloud, `calhacks-13-wyd` | same as the desktop |
| `WYD_WORKER_TOKEN` | saved token | worker identity |
| `COMPILE_PORT` | `8787` | HTTP port (binds `0.0.0.0`) |
| `COMPILE_PUBLIC_URL` | `http://localhost:<port>` | base of the URL written to the db. **Teammates on other laptops can't open `localhost`**: set the host's LAN IP, e.g. `http://192.168.1.20:8787` |
| `COMPILE_OUT_DIR` | `worker/out/compilations` | where videos are written |
| `COMPILE_QUIET_SECS` | `30` | wait after the last change before rendering |
| `FFMPEG_BIN` | `ffmpeg` | |

## Tests
`tests/session-clips/` (`npm run test:clips`): `compile-plan`, `compile-serve`, `compile-render` (needs ffmpeg), `compile.integration` (scratch db + `WYD_TEST_WORKER_TOKEN`; full flow incl. late clip).

## Gotchas
- Chunks of every not-yet-compiled ended session are streamed to the worker on connect (large); a `Ready` compilation removes them from the worker's view.
- URLs point at the developer's machine: they stop working when the process stops (files persist in `worker/out/`; restart serves them again). Maincloud cannot call this server and does not need to.
- No consent/privacy gating: `privacy.md`.
