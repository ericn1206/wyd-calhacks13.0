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
| `worker/compile/network.ts` | `lanAddress()`: the laptop's address for shareable links |
| `worker/compile/page.ts` | The `/session/<id>` HTML (polls `/status` every 3 s: waiting → rendering → video) and the status JSON shape |
| `worker/compile/run.mjs` | Bundles `main.ts` with esbuild (bindings are TS Node can't run) and runs it |

## Flow
```
end_session → session Ended → worker_ended_sessions / worker_session_clips / worker_session_clip_chunks (views open to any connection)
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
Summary screen: the desktop builds `<base>/session/<session.id>` itself. `<base>` = `app_setting` `clip_page_base_url`, which the compiler writes on every start (`set_clip_page_base_url(url)`, http(s) only) from `COMPILE_PUBLIC_URL`; the card's state (waiting/rendering/ready/failed) comes from `my_session_compilations`. Code: `useDb.ts` `clipInfo`, `SummaryScreen.tsx` `HighlightCard`. No card until a compiler has published its address (the video `url` itself is in `session_compilation`, but the page link must exist before that row does).

`<COMPILE_PUBLIC_URL>/session/<session id>` works before the session ends: it shows "waiting for the session to end", then "putting your clips together", then the video, without a reload. Status JSON: `{state: waiting|rendering|ready|failed|empty|offline, clipCount?, video?, error?}`. `waiting` = session not ended (or unknown id); `rendering` = ended with clips, being joined; `empty` = ended and no clip was saved (a clip is recorded only when a check-in fires; reported after the quiet period + 20 s, flips to `rendering` if a late clip arrives); `offline` = the worker lost its database connection and is reconnecting. The id is `session.id` (`tables.sessions[].id` in the desktop snapshot). The page is served by this process, so it only loads while it runs.

## Run
1. `brew install ffmpeg` (needs `ffmpeg` on PATH or `FFMPEG_BIN`).
2. Start it (one compiler per database, see **One compiler** below):

| Command | Links use |
|---|---|
| `npm run clips:host` | this laptop's network address (`en0` first, VPN tunnels last), so teammates on the same network can open them; prints the page address to share |
| `npm run worker:compile` | `COMPILE_PUBLIC_URL`, else `localhost` |

Flag: `--host` (what `clips:host` passes). `COMPILE_PUBLIC_URL` always wins over the detected address.

## One compiler
Not enforced (no lease, no authorization: the compiler reducers/views accept any connection). Two compilers would write different URLs into the same rows and, with `rebuildMissing` on, keep invalidating each other's videos. Run one per database; tell the team who has it.

| Env | Default | Meaning |
|---|---|---|
| `SPACETIME_URI`, `SPACETIME_DB` | maincloud, `calhacks-13-wyd` | same as the desktop |
| `WYD_WORKER_TOKEN` | saved token (`worker/.state/compile-token`) | optional: connect as this identity |
| `COMPILE_PORT` | `8787` | HTTP port (binds `0.0.0.0`) |
| `COMPILE_PUBLIC_URL` | `http://localhost:<port>` | base of the URL written to the db. **Teammates on other laptops can't open `localhost`**: set the host's LAN IP, e.g. `http://192.168.1.20:8787` |
| `COMPILE_OUT_DIR` | `worker/out/compilations` | where videos are written |
| `COMPILE_QUIET_SECS` | `30` | wait after the last change before rendering |
| `FFMPEG_BIN` | `ffmpeg` | |
| `COMPILE_DEBUG` | unset | `1` logs why and after how long each WebSocket closed (`socket closed: code 1006 …`) |

## Tests
`tests/session-clips/` (`npm run test:clips`): `compile-plan`, `compile-serve`, `compile-render` (needs ffmpeg), `network`, `compile.integration` (scratch db; full flow incl. late clip, empty session, reconnect, corrupt clip).

## Gotchas
- A clip with no readable video (checked with ffprobe, which must sit next to ffmpeg; without it nothing is skipped) is left out of the video instead of failing the session; the row stays Ready with `error` = `N unreadable clip(s) left out (ids …)` and `clip_count` still counts it (the module compares that number).
- If every clip of a session is unreadable the render fails (`no readable clips`) and is retried every 60 s.
- Videos are tied to the machine's folder (`COMPILE_OUT_DIR`), so a new machine or a wiped folder would leave Ready rows without files. The compiler therefore checks every Ready row each poll: if `session-<id>-<n>.mp4` is missing it sets the row back to `Rendering` (the module's views then list that session's clips again, since they hide Ready sessions), and the normal path renders it (up to 5 per poll, no quiet wait). Meanwhile the page says "putting your clips together". Option `rebuildMissing` (default on); several compilers with different folders would keep invalidating each other's videos. A first start on a new machine re-renders every old session, which streams their clips again.
- `session_compilation.url` holds a path (`/compilations/session-<id>-<n>.mp4`), not an address: a changed IP or host never stales it. Readers add `app_setting` `clip_page_base_url` (desktop: `clipInfo().clipVideo`). Rows written before 2026-10-25 hold a full address; readers keep those as they are.
- Chunks of every not-yet-compiled ended session are streamed to the worker on connect (large); a `Ready` compilation removes them from the worker's view.
- Endless `disconnected; reconnecting` / `reconnected` every 5-15 s, with `COMPILE_DEBUG=1` showing `code 1006 … clean false`: the network cuts long-lived connections (seen 2026-10-25: any WebSocket or long HTTPS request from that Mac died after 3-12 s, even to unrelated hosts; not the compiler or SpacetimeDB). It still works between drops (each reconnect re-downloads the snapshot, and a reducer call in flight at the drop times out after 20 s and is retried on the next poll). Fix the network: another Wi-Fi or a phone hotspot, VPN/proxy/firewall off.
- URLs point at the developer's machine: they stop working when the process stops (files persist in `worker/out/`; restart serves them again). Maincloud cannot call this server and does not need to.
- No consent/privacy gating: `privacy.md`.
