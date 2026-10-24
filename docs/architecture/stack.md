# Stack

## Packages
| Part | Path | Runtime | Key deps |
|---|---|---|---|
| Desktop | `/` (`src/`) | Electron ^28, electron-vite ^2 | react ^18.2, react-dom, @vitejs/plugin-react ^4, tailwindcss ^4 + @tailwindcss/vite ^4 (renderer), vite ^5.4 (explicit; `npm install` without it breaks), typescript ^5, @anthropic-ai/sdk ^0.27, livekit-client 2.23.0 (exact) |
| Worker | `worker/` | Node 24, ESM, runs `.ts` directly (no build) | @anthropic-ai/sdk ^0.27 |
| SpacetimeDB module | `spacetimedb/` | SpacetimeDB TS module (V8) | spacetimedb 2.13.*, typescript ~5.6 |
| Webcam detector | `vision/` | Python 3.12 venv `vision/.venv`, spawned by desktop main | `requirements.txt`: mediapipe 0.10.21 (last with `mp.solutions`), opencv-contrib-python 4.11.0.86, numpy 1.26.4 · `requirements-train.txt` adds xgboost 3.4.1, pandas 3.0.6, scikit-learn 1.9.1 |

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
| LiveKit Cloud | session presence, calls (unwired in new UI), demo live view; see `../components/livekit-call.md` |
| Cartesia voice agent / TTS | archived in `outdated/` (decided: typed goals, no AI voice) |

## Env vars (`.env`, gitignored)
| Var | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | desktop (`src/main/env.ts` loads `.env`; shell vars win), worker (`--env-file-if-exists=../.env`) |
| `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | desktop main, `livekitToken.ts`; secret never reaches the renderer |
| `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`, `CARTESIA_VOICE_ID` | used only by archived `outdated/` voice code |
| `LOCKIN_DEMO` | `1` → desktop joins the LiveKit room and shows the live camera view switch in the Demo menu |
| `VISION_MODEL` | optional path override for the webcam model (default `vision/distraction_model.json`) |

## Commands
| Do | Run |
|---|---|
| Desktop dev | `npm run dev` (root) |
| Desktop build | `npm run build` |
| Webcam detector env | `npm run setup:vision` (add `-- --train` for training deps) |
| Run detector alone | `vision/.venv/bin/python vision/detector.py --model <json>` (prints JSON lines; Ctrl-D/Ctrl-C to stop) |
| Worker fixtures | `cd worker && npm run fixtures` |
| Build / publish module | `cd spacetimedb && spacetime build` / `spacetime publish` |
| Re-seed after publish | `spacetime call calhacks-13-wyd seed_defaults` |
| Generate client bindings | see `../reference/spacetimedb-sdk.md` (`spacetime generate`) |

## macOS permissions (for the terminal/IDE running dev)
Accessibility/Automation (System Events via `osascript`) · Screen Recording (window titles) · Camera (webcam detector, live view, calls) · Microphone (calls).
