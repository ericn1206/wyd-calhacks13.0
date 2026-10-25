# Stack

## Packages
| Part | Path | Runtime | Key deps |
|---|---|---|---|
| Desktop | `/` (`src/`) | Electron ^28, electron-vite ^2 | react ^18.2, react-dom, @vitejs/plugin-react ^4, tailwindcss ^4 + @tailwindcss/vite ^4 (renderer), vite ^5.4 (explicit; `npm install` without it breaks), typescript ^5, @anthropic-ai/sdk ^0.27, livekit-client 2.23.0 (exact), spacetimedb 2.13.* (client), undici ^6 (WebSocket for the SDK on Node 18) |
| Worker | `worker/` | Node 24, ESM, runs `.ts` directly (no build) | @anthropic-ai/sdk ^0.27 |
| SpacetimeDB module | `spacetimedb/` | SpacetimeDB TS module (V8) | spacetimedb 2.13.*, typescript ~5.6 |
| Distraction trigger | `vision/` | Python 3.12 venv `vision/.venv`, spawned by desktop main on Goals submit | `requirements.txt`: mediapipe 0.10.21, opencv-contrib-python 4.11.0.86, numpy 1.26.4, pillow 11.1.0, google-generativeai 0.8.5. OCR is macOS Vision (`macos_vision_ocr.swift`), not a pip package. |

Desktop build: `electron.vite.config.ts` (main/preload externalize deps; renderer uses React + Tailwind plugins). Root `tsconfig.json`: ES2020, CommonJS, strict.

## Models
| Use | Model | Where |
|---|---|---|
| Desktop judge + onboarding context | `claude-haiku-4-5-20251001` | `src/main/claudeJudge.ts` |
| Worker judge + categorizer | `claude-haiku-5-5`, `effort: low` | `worker/claude.ts` |
| Planned primary judge | small model on AWS Inferentia | not built |

## Other services
| Service | Status |
|---|---|
| SpacetimeDB maincloud, db `calhacks-13-wyd` | `spacetime.json`, `spacetime.local.json` |
| LiveKit Cloud | check-in calls + session presence; see `../components/livekit-call.md`. Code kept but not wired into the new UI |
| Cartesia voice agent | `src/main/cartesiaAgent.ts` + `src/renderer/src/cartesiaCall.ts` (from prod); unrouted while voice is off |

## Env vars (`.env`, gitignored)
| Var | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | desktop (`src/main/env.ts` loads `.env`; shell vars win), worker (`--env-file-if-exists=../.env`) |
| `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | desktop main, `livekitToken.ts`; secret never reaches the renderer |
| `SPACETIME_URI` (default `wss://maincloud.spacetimedb.com`), `SPACETIME_DB` (default `calhacks-13-wyd`) | desktop main, `src/main/db/stdb.ts` (optional overrides) |
| `WYD_DEBUG` (`1`/`0`; default on unless packaged) | desktop main, `src/main/db/debugLog.ts`: logs DB connect/subscribe/reducer calls/state changes to the terminal and `~/Library/Application Support/attentionmaxx/logs/stdb.log` |
| `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID` | `cartesiaAgent.ts` (voice intro; unrouted for now) · `CARTESIA_VOICE_ID` unused |
| `GEMINI_API_KEYS` (comma-separated) or `GEMINI_API_KEY` | `vision/04_screen_monitor.py` (screen text → Gemini; env first, then `.env`). Several keys are used round robin; a 429'd key sits out 60 s, a rejected key 600 s; all unavailable → screen vote `unknown`. Planned: desktop main off-task pipeline (`overview.md#off-task-pipeline`). Not read by the renderer. |

## Commands
| Do | Run |
|---|---|
| Desktop dev | `npm run dev` (root) |
| Vision env | `npm run setup:vision` (creates `vision/.venv`) |
| Distraction trigger alone | `vision/.venv/bin/python vision/facetime_trigger.py "circuits"` (prints `face time`) |
| Desktop build | `npm run build` |
| 2 isolated clients (separate identity/localStorage via `--user-data-dir ~/.wyd-test/client-<i>`; builds once, runs `electron-vite preview`, no HMR) | `npm run dev:two [-- -n 3] [--no-build] [--fresh]` (`scripts/dev-two.sh`; `WYD_TEST_DIR` overrides dir). Same webcam/screen is shared. |
| Session-clips tests (`tests/session-clips/README.md`) | `npm run test:clips [-- ts\|py]` |
| Worker fixtures | `cd worker && npm run fixtures` |
| Clip compiler (needs `ffmpeg`; env in `components/clip-compiler.md`) | `npm run worker:compile` |
| Build / publish module | `cd spacetimedb && spacetime build` / `spacetime publish` |
| Re-seed after publish | `spacetime call calhacks-13-wyd seed_defaults` |
| Generate client bindings | `spacetime generate --lang typescript --module-path spacetimedb --out-dir src/main/db/module_bindings -y` |

## macOS permissions (for the terminal/IDE running dev)
Accessibility/Automation (System Events via `osascript`) · Screen Recording (window titles) · Camera (webcam, Python `vision/` process). Microphone not needed (voice onboarding archived).
