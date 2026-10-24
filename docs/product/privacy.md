# Privacy (hackathon scope)

Demo-only project, not going live. Privacy is not a priority; no consent screen or legal flow required.

- Webcam processing stays on the user's laptop. Frames/video/audio are not uploaded (keeps the demo simple and cheap, not a compliance rule).
- Only small text events go to SpacetimeDB. AI judgment input is text only.
- No explicit consent step. The intro popup (`../ui_integration.md`) is the only onboarding. The DB still has per-sensor consent flags: the client must set them all `true` on join, else `ingest_signal` zeroes the fields (see `../architecture/contracts.md#signalinput`).
- Replay clips (if built): local, deleted at session end.
- Summaries are private to their owner. Anything shown to the group (e.g. a call reason) stays friendly and non-shaming (product tone, not privacy).
