# WYD!! (watchadoin) — Project Context

Cal Hacks 13.0 project. Hard deadline: Devpost submission by Sunday Oct 25, 9:00 AM PST.
Priority is a working, reliable demo over extra features.

## What it is

An opt-in group focus app for small groups (study sessions, remote teammates, co-working pods).
Everyone joins a shared Focus Session. The app watches for *sustained* off-task behavior.
When someone drifts for 2+ minutes, the group gets a short surprise FaceTime-style check-in call
(or a gentle nudge if a call already happened in the last 30 minutes). Calls are rare and auto-end
after ~60 seconds. At the end, each person gets a private summary (% on task, goals completed,
deep-work blocks) and an opt-in "Mario Kart–style" replay of off-task moments.

Tone: drifting should feel social, not shameful. No public shaming.

## User flow

Open app → Join session → Explicit consent (webcam, active app, phone) → Set 2–3 goals →
Pomodoro (25 min) → Tracking → Off task 2+ min?
- No → continue timer
- Yes → Group call in last 30 min? Yes → gentle nudge · No → surprise group call (auto-ends ~60 s)
→ back to tracking → Pomodoro complete? → Continue session? Yes → 5-min break → next Pomodoro ·
No → Session ends → Private summary → Done

## Architecture

```
Each laptop (Electron)                       Phone (web page)
  webcam → MediaPipe signals (local)           page hidden → "phone in use"
  active window → app/title → category              │
          │                                         │
          └──────── small events ──→ SpacetimeDB ←──┘
                                        │   ↑
                                        ↓   │ status, check-in triggers
                                   AI worker (Node/TS)
               small model on AWS Inferentia (fallback: Claude Haiku) for judgment/categorization
               Claude for summaries + replay captions
```

## Tech stack

- Desktop: Electron + React + TypeScript (electron-vite)
- Webcam: MediaPipe Tasks (vision), runs locally in the renderer
- Active window: `get-windows` (ESM-only; load with `await import('get-windows')` in main process)
- Real-time sync: SpacetimeDB (sessions, members, events, status, check-ins)
- AI worker: Node + TypeScript
- Judgment + ambiguous-title categorization: small model on Inferentia; Claude Haiku as fallback
- Summaries + replay captions: Claude
- Voice (optional): Cartesia
- Group check-in call: simplest working approach first (shared hosted video room opened in-app)
- Integrations (optional): Creao agent → Slack recap / scheduled sessions via webhook; Notability PDF export

## Repo structure

```
desktop/   Electron app (main/, preload/, renderer/)
phone/     phone sensor web page
server/    SpacetimeDB module
worker/    AI worker (judgment, categorization, summary, captions)
docs/      Figma stage log notes, screenshots
```

(If actual folder names differ, follow what's in the repo.)

## Event format (shared contract — do not change without telling the team)

```json
{
  "user": "jake",
  "session": "abc123",
  "time": "2026-10-24T01:12:00Z",
  "signals": { "eyes": "open", "posture": "upright", "lookingAway": false, "phoneVisible": false, "phoneInUse": false },
  "activity": { "app": "Chrome", "title": "YouTube", "category": "video" },
  "status": "off_task",
  "confidence": 0.86,
  "reason": "Watching YouTube for 3 minutes"
}
```

- Vision fills `signals`; desktop fills `activity`; AI worker fills `status`, `confidence`, `reason`.
- `status`: `on_task` | `off_task` | `break` (optionally `stuck`)
- Categories: `coding`, `notes`, `docs`, `school`, `chat`, `social`, `video`, `music`, `unknown`

## Rules for AI calls

- Rules + cache first; only send `unknown`/ambiguous titles to a model.
- Judgment input is TEXT ONLY (signals + activity summary), never images or video.
- Smoothing: status changes only after holding ~60 s; confidence < 0.6 counts as neutral.
- AI calls run in the background and never block the UI.
- One Claude call per session for summary + replay captions.

## Privacy rules (non-negotiable)

- All webcam processing stays on the user's laptop. Never upload frames or video to any API.
- Only small text events are shared via SpacetimeDB.
- Replay clips are opt-in, stored locally, deleted when the session closes.
- Everything requires explicit consent at join.

## Mac notes

- Window titles need Screen Recording permission for the terminal/IDE running `npm run dev`.
- Webcam needs Camera permission.

## Team ownership

- Vision: MediaPipe signals, phone sensor page, replay clips
- Backend (2 people): SpacetimeDB module, smoothing, check-in rules/cooldown, check-in call, integrations
- UI + AI: Electron UI screens (from Figma Make prototype), activity tracking + categorization,
  AI worker (judgment, summary, captions), Figma deliverables

## Conventions

- TypeScript everywhere possible.
- One branch per person/feature; small PRs into `main`; run the full flow after each merge.
- Never commit API keys; use `.env` (gitignored).
- Prefer simple, working solutions over clever ones. Ask before adding new dependencies or services.

## Open decisions (ask, don't assume)

- Any scores/leaderboard at all, or summary stats only? (Current direction: no scores.)
- Spoken roasts/voice, or none? (Current direction: no roasts; gentle tone.)
- Is the teammate "close your tab" takeover in scope? (Needs explicit consent; likely cut.)
- Exact check-in call implementation.