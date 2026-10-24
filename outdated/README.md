# outdated/

Pre-integration code kept for reference. Not built (outside `tsconfig` `include`). Paths mirror the original `src/` layout.

| Path | What |
|---|---|
| `src/renderer/src/App.tsx`, `VideoCall.tsx`, `main.tsx`, `index.css`, `global.d.ts`, `index.html` | old UI (start screen, onboarding, status, LiveKit call overlay) |
| `src/renderer/src/cartesiaCall.ts` | voice AI client (Cartesia) |
| `src/main/cartesiaAgent.ts`, `cartesiaTTS.ts`, `macSpeech.ts`, `transcribe.swift`, `sessionManager.ts` | voice AI onboarding (main side) |
| `src/main/index.ts`, `src/preload/index.ts` | old main/preload (`activityAPI`, `sessionAPI`, `circleAPI` channels) |
