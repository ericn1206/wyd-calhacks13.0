# Session clips tests

Feature: `contracts.md#session-clips`. No extra dependencies.

| Command | Runs |
|---|---|
| `npm run test:clips` | everything below (integration only if env set) |
| `npm run test:clips -- ts` / `-- py` | one side |

| File | Covers |
|---|---|
| `python/test_clip_recorder.py` | `vision/detector.py` `ClipRecorder`: 10 s buffer, 10 s before + 20 s after, 320×240 / 8 fps constant-rate H.264, busy rejection, flush on shutdown, no frames, bad path, `mp4v` fallback, stdin `clip <path>` reader |
| `python/test_trigger_forwarding.py` | `vision/facetime_trigger.py`: `clip {json}` re-print without touching the webcam vote, stdin → detector forwarding |
| `ts/clipUpload.test.ts` | `src/main/clipUpload.ts` with a fake DB client: call order, chunk sizes and reassembly, retries, give-up, file deletion, clip dir |
| `ts/facetimeTrigger.test.ts` | `requestClip` is false when tracking is off |
| `ts/module.integration.test.ts` | `session_clip` reducers on a real db (validation, ownership, limits, grace window). Skipped unless env set |

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
