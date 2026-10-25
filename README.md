# WYD!! (watchadoin)

Cal Hacks 13.0 project. An opt-in group focus app: when someone drifts off task for a while, the group gets a short surprise check-in call. Drifting feels social, not shameful. Each person gets a private summary at the end.

The app is a **macOS-only Electron desktop app**. It talks to a hosted SpacetimeDB database (maincloud), uses Gemini to judge what's on your screen, and LiveKit Cloud for check-in calls.

## What runs where

| Part | Path | Needed to run the app? | Where it runs |
|---|---|---|---|
| Desktop app (Electron + React) | `src/` | **Yes** | Your Mac |
| Vision detector (webcam + screen OCR, Python) | `vision/` | **Yes** (drift detection; spawned by the app) | Your Mac, in `vision/.venv` |
| SpacetimeDB module (session state, rules) | `spacetimedb/` | Already published to maincloud (db `calhacks-13-wyd`). Only republish if you changed it | SpacetimeDB maincloud |
| Clip compiler (joins session clips into one video) | `worker/compile/` | Optional | Your Mac, Node + ffmpeg |
| AI worker fixtures | `worker/` | Optional (dev only) | Your Mac, Node 24 |

## 1. Prerequisites

macOS (Apple Silicon or Intel) is required: window tracking uses `osascript` and OCR uses the macOS Vision framework.

Install [Homebrew](https://brew.sh) first if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install the tools:

```bash
# Xcode command line tools (provides swift, needed for screen OCR)
xcode-select --install

# Node (via nvm) and Python 3.12
brew install nvm python@3.12 ffmpeg
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

nvm install 20      # desktop app + clip compiler
nvm install 24      # only for `worker` fixtures
nvm use 20

# SpacetimeDB CLI (only needed to publish/inspect the database)
curl -sSf https://install.spacetimedb.com | sh
```

Check everything:

```bash
node -v             # v20.x
python3.12 --version
ffmpeg -version | head -1
swift --version | head -1
spacetime --version
```

| Tool | Version | Used for |
|---|---|---|
| Node | 20 (24 for `worker/` fixtures only) | desktop app, clip compiler |
| Python | 3.12 exactly (mediapipe 0.10.21 has no wheels for newer) | `vision/` |
| ffmpeg | any recent | clip compiler, session clips |
| Xcode CLT (`swift`) | any | `vision/macos_vision_ocr.swift` |
| SpacetimeDB CLI | 2.x | publish/inspect the module (optional) |

## 2. Clone and install

```bash
git clone https://github.com/ericn1206/attentionmaxx.git
cd attentionmaxx
npm install
npm run setup:vision    # creates vision/.venv and installs mediapipe, opencv, numpy, pillow, google-generativeai
```

`setup:vision` ends with `vision ready: mediapipe 0.10.21 opencv 4.11.0`. If it says Python 3.12 is missing, run `PYTHON=/path/to/python3.12 npm run setup:vision`.

## 3. Create `.env`

Create `.env` in the repo root (it is gitignored; never commit keys):

```bash
cat > .env <<'EOF'
# Required: Gemini judges your screen text (drift detection + goal summaries)
GEMINI_API_KEY=

# Required for check-in calls (LiveKit Cloud project: https://cloud.livekit.io)
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# Optional
# GEMINI_API_KEYS=key1,key2,key3      # vision monitor round-robins these (avoids 429s)
# SPACETIME_URI=wss://maincloud.spacetimedb.com
# SPACETIME_DB=calhacks-13-wyd
# WYD_DEBUG=1                         # DB debug logs in terminal + ~/Library/Application Support/attentionmaxx/logs/stdb.log
# CARTESIA_API_KEY=                   # voice intro, currently unrouted
# CARTESIA_AGENT_ID=
EOF
```

Fill in the values:

| Var | Where to get it | If missing |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Screen vote is `unknown`; the drift check-in can never fire |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project → Settings → Keys | Check-in calls fail to connect |

Full env list: `docs/architecture/stack.md`.

## 4. Run the app

```bash
npm run dev
```

The first launch opens the Electron window. Create a session (you get a join code), or join a teammate's with their code, enter a goal ("What do you want to do?"), then start the round. Drift detection starts when you submit the goal and a round is running.

### macOS permissions

macOS prompts on first use. Grant them to the app that launches `npm run dev` (Terminal, iTerm, VS Code, Cursor…) under **System Settings → Privacy & Security**:

| Permission | Why | If missing |
|---|---|---|
| Camera | webcam distraction detector (`vision/detector.py`) | no webcam vote, no clips |
| Screen Recording | screen OCR, window titles, screen share in check-in calls | screen vote unknown; call is camera-only |
| Accessibility | read front app / window title | activity tracking empty |
| Automation → System Events (and your browser) | `osascript` for front app + browser URL | same |

After granting, **fully quit and reopen** the terminal app, then rerun `npm run dev`.

### Run two clients on one machine (test a group session)

```bash
npm run dev:two                   # two isolated instances (separate identity + storage)
npm run dev:two -- -n 3           # three instances
npm run dev:two -- --no-build     # reuse the previous build
npm run dev:two -- --fresh        # wipe their saved data first
```

Create a session in client 1, join from client 2 with the code. Both share your webcam and screen. Data lives in `~/.wyd-test/client-<i>`.

### Run the detector alone (no Electron)

```bash
vision/.venv/bin/python vision/facetime_trigger.py "circuits" "Google Chrome"
```

Prints `face time` when you've drifted (screen off-task twice in a row, or webcam distracted twice while the screen looks on-task).

## 5. SpacetimeDB (only if you change `spacetimedb/`)

The app already points at the published maincloud database `calhacks-13-wyd` (`spacetime.json`). Teammates do **not** need to publish. Do this only after editing the module:

```bash
spacetime login                                  # once
cd spacetimedb && npm install                    # once
spacetime build
spacetime publish calhacks-13-wyd                # additive changes keep data
spacetime call calhacks-13-wyd seed_defaults     # re-seed settings after a data-deleting publish
cd ..

# regenerate client bindings (never edit src/main/db/module_bindings by hand)
spacetime generate --lang typescript --module-path spacetimedb --out-dir src/main/db/module_bindings -y
```

Breaking schema changes need `--delete-data=on-conflict` on publish and wipe the data. Tell the team first. Details: `docs/components/spacetimedb.md`.

## 6. Clip compiler (optional)

After a session ends, this joins every member's check-in clip into one video and writes its URL to the database.

```bash
# 1. Authorize a worker identity. Use the token of the identity that published the db:
grep spacetimedb_token ~/.config/spacetime/cli.toml
export WYD_WORKER_TOKEN=<that token>

# 2. Start it (ffmpeg must be on PATH)
npm run worker:compile
```

For teammates on other laptops to open the video, set your LAN IP before starting:

```bash
COMPILE_PUBLIC_URL=http://192.168.1.20:8787 npm run worker:compile
```

Videos land in `worker/out/compilations/`. All options: `docs/components/clip-compiler.md`.

## 7. Tests and build

```bash
npm run test:clips                 # session-clips tests (python side needs vision/.venv)
npm run test:clips -- ts           # TS tests only
npm run test:clips -- py           # Python tests only
npm run build                      # production build into out/

# AI worker fixtures (Node 24, needs GEMINI_API_KEY in .env)
nvm use 24
cd worker && npm install && npm run fixtures && cd ..
nvm use 20
```

The clip integration test needs a scratch database, never maincloud: see `tests/session-clips/README.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run setup:vision`: "Python 3.12 not found" | `brew install python@3.12` or `PYTHON=/path/to/python3.12 npm run setup:vision` |
| `mediapipe` fails to install | Python must be 3.12 and the venv must be recreated: `rm -rf vision/.venv && npm run setup:vision` |
| Drift never triggers | `GEMINI_API_KEY` missing/invalid, or Screen Recording not granted. Use the Demo menu → "Detector log" to see each verdict |
| Gemini 429s | Add several keys: `GEMINI_API_KEYS=key1,key2` |
| Camera is off / no webcam vote | Grant Camera to the terminal app, then restart it |
| Check-in call won't connect | Check the three `LIVEKIT_*` vars; URL must start with `wss://` |
| `npm install` errors about vite | Keep `vite` pinned in `package.json` (`^5.4`); delete `node_modules` and `package-lock.json` only as a last resort |
| Dock icon missing / odd window behavior | See `docs/status.md` Gotchas (macOS overlay) |
| Need DB logs | `WYD_DEBUG=1 npm run dev`, or `tail -f ~/Library/Application Support/attentionmaxx/logs/stdb.log` |
| Teammates see different data | Everyone must use the same `SPACETIME_DB` (default `calhacks-13-wyd`) |

## Docs

Start at `docs/status.md`. Project rules for AI agents: `CLAUDE.md`.
