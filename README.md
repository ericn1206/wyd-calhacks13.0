# WYD!! (watchadoin)

Cal Hacks 13.0 project. An opt-in group focus app: when someone drifts off task for a while, the group gets a short surprise check-in call. Drifting feels social, not shameful. Each person gets a private summary at the end.

## Run

```bash
npm install
npm run dev   # Electron app (macOS); reads .env
```

- `.env` (gitignored): `ANTHROPIC_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Full list: `docs/architecture/stack.md`.
- macOS permissions for the terminal/IDE running it: Accessibility/Automation (System Events), Screen Recording (window titles), Camera, Microphone.
- AI worker fixtures: `cd worker && npm install && npm run fixtures` (Node 24, reads `../.env`).
- SpacetimeDB module: `cd spacetimedb && spacetime publish` (see `docs/components/spacetimedb.md`).

## Docs

Start at `docs/status.md`. Project rules for AI agents: `CLAUDE.md`.
