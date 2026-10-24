# Privacy (hackathon scope)

Demo-only project, not going live. Privacy is not a priority; no consent screen or legal flow required.

- Webcam processing stays on the user's laptop. Frames/video/audio are not uploaded (keeps the demo simple and cheap, not a compliance rule).
- Only small text events go to SpacetimeDB. AI judgment input is text only.
- No consent step and no DB consent flags. The intro popup (`../ui_integration.md`) is the only onboarding.
- Replay clips (if built): local, deleted at session end.
- Summaries are private to their owner. Anything shown to the group (e.g. a call reason) stays friendly and non-shaming (product tone, not privacy).
