# Stack

## Packages
| Part | Path | Runtime | Key deps |
|---|---|---|---|
| Desktop | `/` (`src/`) | Electron ^28, electron-vite ^2 | react ^18.2, react-dom, @vitejs/plugin-react ^4, typescript ^5, @anthropic-ai/sdk ^0.27, livekit-client 2.23.0 (exact) |
| Worker | `worker/` | Node 24, ESM, runs `.ts` directly (no build) | @anthropic-ai/sdk ^0.27 |
| SpacetimeDB module | `spacetimedb/` | SpacetimeDB TS module (V8) | spacetimedb 2.13.*, typescript ~5.6 |

Desktop build: `electron.vite.config.ts` (main/preload externalize deps; renderer uses React plugin). Root `tsconfig.json`: ES2020, CommonJS, strict.

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
| LiveKit Cloud | check-in calls + session presence; see `../components/livekit-call.md` |
| Cartesia voice agent | onboarding today (`cartesiaAgent.ts`, `cartesiaCall.ts`); to be replaced by a typed questionnaire |

## Env vars (`.env`, gitignored)
| Var | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | desktop (`src/main/env.ts` loads `.env`; shell vars win), worker (`--env-file-if-exists=../.env`) |
| `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | desktop main, `livekitToken.ts`; secret never reaches the renderer |
| `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID` | desktop main, `cartesiaAgent.ts` (voice onboarding, to be removed) |
| `CARTESIA_VOICE_ID` | unused |

## Commands
| Do | Run |
|---|---|
| Desktop dev | `npm run dev` (root) |
| Desktop build | `npm run build` |
| Worker fixtures | `cd worker && npm run fixtures` |
| Build / publish module | `cd spacetimedb && spacetime build` / `spacetime publish` |
| Re-seed after publish | `spacetime call calhacks-13-wyd seed_defaults` |
| Generate client bindings | see `../reference/spacetimedb-sdk.md` (`spacetime generate`) |

## macOS permissions (for the terminal/IDE running dev)
Accessibility/Automation (System Events via `osascript`) · Screen Recording (window titles) · Camera (webcam, calls) · Microphone (calls, voice onboarding).
