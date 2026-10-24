Cleaned Tech Stack







PieceChoiceNotes

Desktop appElectron + React + TypeScriptFast, good webcam + screen access, solid for demoWebcam signalsMediaPipe Tasks (Vision)Face presence + rough head/eye direction. Keep it simple and local. Drop heavy posture/phone-object detection if it’s noisyActive window/tabget-windows (or equivalent)Screen Recording permission on Mac. Used as supporting signal, not the sole judgePhone signalSimple companion web pageDetects visibility / unlock roughly. Hosted on Vercel or local. Optional but usefulReal-time sync + session stateSpacetimeDB or simpler alternative (Convex / PartyKit / custom WebSocket)Sessions, who’s in the circle, off-task events, trigger for the group call. SpacetimeDB is fine if you already like it; otherwise a lighter real-time layer may be fasterOff-task judgmentClaude Haiku (or similar fast model)Takes recent signals + context and decides “sustained off-task.” Does not generate roastsGroup video callWebRTC (Daily, LiveKit, or simple custom)The key demo moment. When the agent decides someone is off-task, it triggers an instant group video room that opens for everyone in the sessionVoice (optional but strong)CartesiaCalm session start (“FocusCircle is live”), soft end-of-session voice summary, or a gentle “Circle is joining” cue. No roastingSession summaryClaude → clean PDF or markdownPrivate per person. Focuses on deep blocks and shared time. Easy Notability import if you want that trackDesignFigmaKeep as-is