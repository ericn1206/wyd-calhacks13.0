# Clip compiler

Purpose: after a session ends, join its clips (`session_clip`, `contracts.md#session-clips`) into one video, host it, and publish the URL in `session_compilation`. Clips stay in SpacetimeDB. Runs as a local Node process during dev/testing.

## Files
| Path | Role |
|---|---|
| `worker/compile/main.ts` | Entry: env → `startCompiler` |
| `worker/compile/compiler.ts` | Subscribes as a worker identity, decides, renders, reports (`setSessionCompilation`) |
| `worker/compile/plan.ts` | Pure: `orderClips`, `dueSessions`, `videoName`, `staleVideos` |
| `worker/compile/render.ts` | ffmpeg join (`ffmpegArgs`, `renderCompilation`) |
| `worker/compile/serve.ts` | HTTP: `GET /compilations/session-<id>-<n>.mp4` (Range, CORS `*`), `GET /health` |
| `worker/compile/run.mjs` | Bundles `main.ts` with esbuild (bindings are TS Node can't run) and runs it |

## Flow
```
end_session → session Ended → worker_ended_sessions / worker_session_clips / worker_session_clip_chunks (worker-only views)
worker: wait COMPILE_QUIET_SECS since the last change (clips of the last 20 s arrive after the end) and all chunks held
  → setSessionCompilation(Rendering) → ffmpeg → worker/out/compilations/session-<id>-<n>.mp4
  → setSessionCompilation(Ready, clipCount n, url) → members read it from my_session_compilations (desktop snapshot key `compilations`)
```
- Views list only sessions whose complete clips are not already in a `Ready` compilation of the same `clipCount`: a late clip makes the session reappear, it is re-rendered to a new file name (`-<n>`), and older files of that session are deleted.
- Order: `momentAtMs`, then clip id. Output: 320×240, 8 fps, H.264, faststart, no audio. Each input is normalised and joined with ffmpeg's concat filter (mixed size/codec is fine).
- `Failed` → error text in the row; retried after 60 s.

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
