# WYD!! (watchadoin)

Cal Hacks 13.0 project. An opt-in group focus app: when someone drifts off task for a while, the group gets a short surprise check-in call. Drifting feels social, not shameful. Each person gets a private summary at the end.

The app is a **macOS-only Electron desktop app**. It talks to a hosted SpacetimeDB database (maincloud), uses Gemini to judge what's on your screen, and LiveKit Cloud for check-in calls.

## What runs where

| Part | Path | Needed to run the app? | Where it runs |
|---|---|---|---|
| Desktop app (Electron + React) | `src/` | **Yes** | Your Mac |
| Vision detector (webcam + screen OCR, Python) | `vision/` | **Yes** (drift detection; spawned by the app) | Your Mac, in `vision/.venv` |
| SpacetimeDB module (session state, rules) | `spacetimedb/` | Already published to maincloud (db `calhacks-13-wyd`). Only republish if you changed it | SpacetimeDB maincloud |
| Clip compiler (joins session clips into one video and hosts it) | `worker/compile/` | Optional: needed for the highlight video link. **One per database** | One Mac, Node + ffmpeg |
| AI worker fixtures (judge test scenarios; **not** the clip compiler) | `worker/` | Optional (dev only) | Your Mac, Node 24 |

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
| Screen Recording | screen OCR, window titles, screen share in check-in calls, and the screen part of session clips | screen vote unknown; call is camera-only; clips are webcam only (the terminal prints `screen recording off: Screen Recording permission is not granted...`) |
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

### Test with two separate devices

Use this to try the full flow (check-in, clip, highlight video) across two Macs. Both need sections 1-3 done (Node, Python 3.12, `npm install`, `npm run setup:vision`, `.env`) and the **same branch**:

```bash
git clone -b feat/clips-two-device https://github.com/ericn1206/attentionmaxx.git
```

**Step 0, once, on one Mac: a database that matches this branch.** This branch's module has a breaking change (status label `Unknown` renamed to `Idle`), so it cannot be published over `calhacks-13-wyd` without wiping that database. Use a separate test database instead; a new one has nothing to wipe:

```bash
spacetime login
spacetime publish calhacks-13-wyd-test --module-path spacetimedb -y
```

The account that publishes becomes the database's worker (needed for the clip compiler). Then **both** Macs add the same line to `.env`:

```
SPACETIME_DB=calhacks-13-wyd-test
```

**Step 1, Mac A (the host): start the clip compiler.** Both Macs must be on the same Wi-Fi (a VPN on either one can break the links and Gemini).

```bash
npm run clips:host
```

It prints the page address to share (`http://<A's address>:8787/session/<id>`). Allow incoming connections if macOS asks. Any Mac can run it (no authorization step). Run only one compiler per database.

**Step 2, both Macs: run the app.**

```bash
npm run dev
```

Mac A creates a session and reads out the code. Mac B joins with it. Both enter a goal and the host starts the round.

**Step 3: make someone drift.** On either Mac switch to something clearly off-task (a YouTube video) for about 15 seconds. After two off-task checks (5 s apart) the check-in fires on that Mac. **Stay in the session for 30 more seconds** so the 20 s after the check-in is recorded, then have the host end the session.

**Step 4: look at the result.** About 30 seconds later the summary screen shows a "Session highlights" card. Open its link on either Mac: it says "putting your clips together" and then plays the video. It shows the drifter's screen with their webcam in the corner (WYD's own windows are left out). If nothing was recorded it says "No highlights this time".

What to check: the clip came from the Mac that drifted (not from the call), the screen is visible and the check-in tiles are not in it, the link opens on the other Mac, and quitting the app leaves no `facetime_trigger.py` running (`pgrep -f facetime_trigger`).

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

Breaking schema changes need `--delete-data=on-conflict` on publish and wipe the data. Tell the team first. **This branch contains one** (`StatusLabel` `Unknown` renamed to `Idle`): publishing it to `calhacks-13-wyd` wipes sessions, clips and compilations, so test against a separate database (see "Test with two separate devices"). Details: `docs/components/spacetimedb.md`.

## 6. Clip compiler (optional)

What gets recorded: when the check-in fires, the drifting person's own laptop saves 10 s before and 20 s after as one 1280x720 clip (their screen, with their webcam in the corner), recorded locally and uploaded straight from that laptop, not taken from the video call. After the session ends, the compiler joins every clip of the session into one video and hosts it. The clips themselves stay in the database.

### First run

The compiler runs from the **repo root** and needs nothing beyond the normal install (section 2). Do **not** run `cd worker && npm install && npm run fixtures` for it: that is the separate AI-judge test (section 7) and has nothing to do with clips.

1. `brew install ffmpeg` (only on the Mac that hosts the compiler).
2. `npm run clips:host`. It should print `connected as <identity>; serving ...` and the page address to share; `http://localhost:8787/health` answers `ok`.
3. Leave it running while you use the app (`npm run dev` in another terminal); stop it with Ctrl+C.

If it will not start: `unknown reducer` means the database does not have this branch's module yet (publish it, see section 5); the module must be the lease-free one from this branch. More in Troubleshooting.

```bash
npm run clips:host            # links use this Mac's network address, so other devices can open them
npm run worker:compile        # links use COMPILE_PUBLIC_URL, else localhost (single-machine tests)
```

- Needs `ffmpeg` (`brew install ffmpeg`), only on the Mac that runs the compiler.
- **Run one compiler per database.** Nothing enforces it: two would write different URLs into the same rows and re-render each other's videos. Tell the team who runs it.
- It re-renders any video whose file is missing (new Mac, wiped folder).
- Videos are written to `worker/out/compilations/` and served on port 8787 while it runs. `http://<host>:8787/session/<id>` is a page that waits, then plays the video; `/health` checks the server.
- Options (`COMPILE_PORT`, `COMPILE_PUBLIC_URL`, `COMPILE_QUIET_SECS`, `FFMPEG_BIN`, ...): `docs/components/clip-compiler.md`.

### Find a compiled video by hand

Run these on the Mac that runs the compiler, from the repo root. Videos are named `session-<session id>-<clip count>.mp4`, so you need the session's numeric id, not its name or join code.

1. **Get the session id** from its name or join code:
   ```bash
   spacetime sql calhacks-13-wyd "SELECT id, name, code, state FROM session WHERE name = 'My session'"
   spacetime sql calhacks-13-wyd "SELECT id, name, code, state FROM session WHERE code = 'ABC123'"
   spacetime sql calhacks-13-wyd "SELECT id, name, code, state FROM session"   # all sessions, newest id last
   ```
   Names are not unique. If several rows match, pick by `id` (higher = newer). The id is also the number in the share link `http://<host>:8787/session/<id>`.
2. **Check it compiled** (`status` should print `(ready = ())`; `clip_count` is the `<n>` in the file name; `url` is `(some = "/compilations/session-<id>-<n>.mp4")`):
   ```bash
   spacetime sql calhacks-13-wyd "SELECT session_id, status, clip_count, url, error FROM session_compilation WHERE session_id = 7"
   ```
   No row yet means the compiler has not started on it (the session must be `Ended`, then it waits `COMPILE_QUIET_SECS`, 30 s by default).
3. **Open the file**:
   ```bash
   ls worker/out/compilations/ | grep '^session-7-'      # the file for session 7
   open worker/out/compilations/session-7-3.mp4          # plays it (3 clips)
   ```
   Or in a browser while the compiler runs: `http://<host>:8787/session/7` (page) or `http://<host>:8787/compilations/session-7-3.mp4` (file).

Notes:
- The compiler deletes older videos of the same session when a late clip makes a new one, so at most one file per session remains.
- No file, but the row is `Ready`: the video was made on another Mac or the folder was wiped. Start the compiler on this Mac (it rebuilds missing files), or look in `COMPILE_OUT_DIR` on the original Mac.
- `status` `(failed = ())`: read `error`; failed sessions are retried every 60 s.
- `spacetime sql` shows the clips themselves too: `SELECT id, session_id, moment_at_ms, size_bytes, complete FROM session_clip WHERE session_id = 7`. The video bytes stay in the database (`session_clip_chunk`).

## 7. Tests and build

```bash
npm run test:clips                 # session-clips tests (python side needs vision/.venv; needs ffmpeg)
npm run test:clips -- ts           # TS tests only
npm run test:clips -- py           # Python tests only
npm run build                      # production build into out/

# AI worker fixtures: judge test scenarios, optional, NOT needed for the clip compiler (Node 24, needs GEMINI_API_KEY in .env)
nvm use 24
cd worker && npm install && npm run fixtures && cd ..
nvm use 20
```

The integration tests (database, compiler) are skipped unless pointed at a scratch database, never maincloud: see `tests/session-clips/README.md`.

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
| `clips:host` / `worker:compile` fails with an unknown reducer | The database has an older module. Publish this branch's module to the database you use (test database: see "Test with two separate devices") |
| Highlight links point at the wrong Mac, or videos keep re-rendering | Two compilers are running on one database. Stop all but one (nothing enforces it) |
| Clip shows only the webcam / log says `screen recording off` | Grant Screen Recording to the app that launched `npm run dev`, then quit and reopen it |
| Highlight page says "waiting" forever | The session has not ended, or the compiler is not running. "No highlights this time" means the check-in never fired in that session (Gemini unreachable? see "Drift never triggers") |
| Link works on the host but not on the other device | Same Wi-Fi? VPN off? Allow incoming connections for Node in the macOS firewall. Start with `npm run clips:host` (not `worker:compile`) so links use the network address |
| `facetime_trigger.py` still running after quitting | Should not happen any more (it stops itself within ~4 s). If it does: `pkill -f facetime_trigger` and report it |
| Teammates see different data | Everyone must use the same `SPACETIME_DB` (default `calhacks-13-wyd`) |

## Docs

Start at `docs/status.md`. Project rules for AI agents: `CLAUDE.md`.
