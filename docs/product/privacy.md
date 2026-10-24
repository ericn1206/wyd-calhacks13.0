# Privacy (non-negotiable)

- Webcam processing runs on the user's laptop only. Never upload frames, images, video, or audio to any API or to SpacetimeDB.
- Only small text events are shared (SpacetimeDB). AI judgment input is text only (signals + activity summary).
- Explicit consent at join, per sensor: webcam, activity, phone (optional sensor), replay clips. The DB enforces it in `ingest_signal` (non-consented fields are zeroed/dropped; see `../architecture/contracts.md#signalinput`).
- Replay clips: opt-in, stored locally, deleted when the session closes. DB holds only metadata + a hash of the local path.
- Summaries are private to their owner. Anything shown to the group (e.g. a call reason) must be friendly and non-shaming.
- Window titles can contain sensitive text; only the AI worker and DB see them, never other members.
