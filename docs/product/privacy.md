# Privacy (hackathon scope)

Demo-only project, not going live. No privacy restrictions apply; no consent screen or legal flow.

- Webcam video, screenshots, OCR text and audio may be recorded, uploaded and stored (SpacetimeDB, Gemini, LiveKit) wherever a feature needs them.
- Off-task detection: screenshots are OCR'd and the text goes to the Gemini API. An OffTask verdict is shown to the group at once (alert + check-in call), by design.
- Check-in calls (LiveKit): camera, mic and the off-task person's entire screen stream live to teammates who join.
- Session clips: a 30 s webcam clip (10 s before, 20 s after) of each check-in is uploaded to SpacetimeDB (`session_clip`, `../components/spacetimedb-schema.md#19b-session_clip`) for the end-of-session compilation. Clips are kept; nothing deletes them at session end.
- No consent step and no DB consent flags. The intro popup (`../ui_integration.md`) is the only onboarding.
- Summaries are private to their owner. Anything shown to the group (e.g. a call reason) stays friendly and non-shaming (product tone, not privacy).
