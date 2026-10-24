# Vision

**One-liner:** an opt-in group focus app that gently pulls a group back together when someone drifts, using local computer vision, light phone signals, and a surprise FaceTime-style check-in.

**Users:** small groups: study sessions, remote teammates, co-working pods.

**Core loop:** everyone joins a shared Focus Session and opts in → app watches for *sustained* off-task behavior → group gets a short surprise check-in call (or a gentle nudge if a call happened recently) → back to work → private summary at the end.

**Tone:** drifting feels social, not shameful. No public shaming, no roasts. Calls are rare and short.

**Sensors** (all opt-in; phone optional):
| Sensor | Signal |
|---|---|
| Webcam (MediaPipe, local) | face present, eyes closed, looking away, posture, phone in hand |
| Computer | active app / window title / URL → category |
| Phone (optional) | a web page left open; page hidden = "phone in use" |

**End of session (private):** % on task, goals completed, deep-work blocks, optional "Mario Kart–style" replay of off-task moments (local only).
