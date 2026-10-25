# Session clips tests

Feature: `contracts.md#session-clips`. No extra dependencies.

| Command | Runs |
|---|---|
| `npm run test:clips` | everything below (integration only if env set) |
| `npm run test:clips -- ts` / `-- py` | one side |

| File | Covers |
|---|---|
| `python/test_clip_recorder.py` | `vision/clip_recorder.py`: webcam + screen buffers (10 s, thread-safe), 10 s before + 20 s after, 1280x720 / 10 fps composite (screen picture, webcam inset, letterbox, webcam-only, screen-only), busy rejection, flush, errors, `mp4v` fallback, `ScreenSampler` (rate, failures, give-up) |
| `python/test_detector_stdin.py` | `vision/detector.py`: stdin `clip <path>` reader, raw + model-sized camera frame, screen sampler start (`WYD_APP_PID`, off-macOS fallback, no Screen Recording permission → webcam only + message) |
| `python/test_screen_capture.py` | `vision/screen_capture.py` on the real window server (macOS): BGR frame, excluding a process removes exactly its windows |
| `python/test_trigger_forwarding.py` | `vision/facetime_trigger.py`: `clip {json}` re-print without touching the webcam vote, stdin → detector forwarding, stop on stdin EOF/SIGTERM with the watchdog (incl. two real-process tests: a hung trigger and its child both die) |
| `ts/clipUpload.test.ts` | `src/main/clipUpload.ts` with a fake DB client: call order, chunk sizes and reassembly, retries, give-up, file deletion, clip dir |
| `ts/facetimeTrigger.test.ts` | `requestClip` is false when tracking is off |
| `ts/module.integration.test.ts` | `session_clip` reducers on a real db (validation, ownership, limits, grace window). Skipped unless env set |
| `ts/compile-plan.test.ts` | `worker/compile/plan.ts`: clip order, when a session is due (quiet period, all chunks, retry back-off), file names, which Ready rows have no file here |
| `ts/compile-serve.test.ts` | `worker/compile/serve.ts`: Range/206/416, HEAD, CORS, 404 for anything but compiled videos, path tricks; `/session/<id>` page and `/status` JSON for every state, numeric ids only |
| `ts/compile-render.test.ts` | `worker/compile/render.ts` with real ffmpeg: order, mixed size/codec, no leftovers, errors. Skipped without ffmpeg |
| `ts/network.test.ts` | `worker/compile/network.ts` `lanAddress`: Wi-Fi first, VPN/virtual last, loopback/link-local/IPv6 ignored |
| `ts/summary-link.test.ts` | `useDb.ts` `clipInfo`: summary-screen link, state and video address (stored path + current base) from `app_setting` + `session_compilation` |
| `ts/compile.integration.test.ts` | Full flow on a real db: upload clips, end session, compiler renders + hosts, URL in `compilations`, late clip re-render, ended session without clips → `empty`, dropped connection → `offline` then recovers. Needs ffmpeg |

Python needs `cv2` + `numpy`: uses `vision/.venv` (`npm run setup:vision`), else `WYD_TEST_PYTHON=/path/to/python`; skipped with a message if missing.

## Integration test
Scratch db only, never maincloud:
```
spacetime start --listen-addr 127.0.0.1:3917
spacetime publish clipscratch --server http://127.0.0.1:3917 --module-path spacetimedb --anonymous -y
WYD_TEST_STDB_URI=ws://127.0.0.1:3917 WYD_TEST_STDB_DB=clipscratch npm run test:clips -- ts
```
Each run adds sessions and up to 20 clips per test identity; use a fresh db when it gets crowded.

## Not covered
Real camera, Electron click-through, `my_session_clips` view (needs a second identity reading views), compilation (not built).
