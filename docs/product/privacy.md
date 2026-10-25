# Privacy (hackathon scope)

Demo-only project, not going live. Privacy is not a priority; no consent screen or legal flow required.

- Webcam processing stays on the user's laptop. Frames/video/audio are not uploaded (keeps the demo simple and cheap, not a compliance rule).
- Only small text events go to SpacetimeDB. AI judgment input is text only.
- Off-task detection (accepted for the demo): screenshots are taken and OCR'd on the laptop and never uploaded. The OCR text of the screen is sent to the Gemini API to classify OnTask/OffTask. That text can include private on-screen content. Only the verdict plus app/title/domain goes to SpacetimeDB, and an OffTask verdict is shown to the group at once (alert + check-in call), by design.
- Check-in calls (LiveKit): camera, mic and the off-task person's **entire screen** are streamed live to teammates who click Join (3 s invite), for the 30 s call only; nothing is recorded. The sharer's WYD overlay (everyone's camera tiles) is excluded from the capture (`setContentProtection` while sharing).
- No consent step and no DB consent flags. The intro popup (`../ui_integration.md`) is the only onboarding.
- Replay clips (if built): local, deleted at session end.
- Summaries are private to their owner. Anything shown to the group (e.g. a call reason) stays friendly and non-shaming (product tone, not privacy).
