# Distraction trigger

## Purpose
On Goals submit, run the webcam detector and the screen monitor. Print `face time` after two matching intervals.

## Files
| File | Role |
|---|---|
| `vision/detector.py` | Webcam. One JSON line/s. `distracted` is the webcam vote. From `webcam-activity`. |
| `vision/04_screen_monitor.py` | Screenshot → macOS Vision (`macos_vision_ocr.swift`) → Gemini. `ui_state["is_off_task"]` is the screen vote. |
| `vision/facetime_trigger.py` | Spawns `detector.py`, calls `check_once` each interval, prints `face time`. |
| `src/main/facetimeTrigger.ts` | Spawns the trigger on `wyd:tracking:start`; a `face time` line → `publishFacetime()` (`src/main/index.ts`) shows the overlay and sends `facetime:start`. Stops on quit. |
| `src/renderer/src/overlay/LiveCheckIn.tsx` | `circleAPI.onFacetime` → joins the session's LiveKit room and shows the live check-in; the mock check-in is hidden while it runs. |

## Rule
| Key | Value |
|---|---|
| Interval | 5 s (`INTERVAL_SEC` in `facetime_trigger.py`; standalone screen loop `CHECK_INTERVAL` matches) |
| Screen vote | Gemini on the OCR text, with context: the front app (`frontmost_app()` via `osascript`) and the sites/apps the user mentioned — a guide, not a whitelist. Off when not related to the goal or to organizing it (different subject, messaging, social, entertainment, shopping); planning tools (calendar, to-do, notes, course pages, email about the task) are on; ambiguous → on. Two off votes in a row fire; webcam is ignored on this path. Args: `facetime_trigger.py <goal> [mentioned sites/apps]`. |
| Webcam path | Screen on-task both intervals, and webcam `distracted` both intervals. |
| Fire | Either path prints `face time` once. Any other interval resets both streaks. |
| Debug | Every interval prints `debug {status, screen, reason, ocrChars, webcam, face, prob, screenStreak, camStreak}` → main keeps the last 300 → Demo menu "Detector log" window; "Dock debug" toggle shows the latest as chips on the dock (verdict · OCR · webcam · streaks · current app). |
| Dock pill | While tracking, `On task` or `Off task` plus Gemini's short line about the latest screenshot (`On task: Reading chemistry notes`). Idle when not tracking. |
| Status | Each interval with a verdict prints `status off` (screen off, or screen ok + webcam distracted) or `status on`; unknown prints nothing. → `wyd:detector-status` → `ingest_signal` → status table, which every status dot reads (own dock via `OverlayState.selfStatus`, partners via `members`). |
| On fire | Overlay opens the live LiveKit check-in (`LiveCheckIn.tsx`) for the session code and **shares the drifter's screen** (`startCall({ shareScreen: true })`, entire screen via `setDisplayMediaRequestHandler`). Teammates get a 3 s Join invite; joiners see the share window (screen big, drifter's webcam bottom-right, others bottom-left). Needs Screen Recording permission; without it the call runs camera-only. |

## Run
1. `npm run setup:vision`
2. `GEMINI_API_KEY` in `.env` or the environment. Without it the screen vote is unknown, so the OCR path cannot fire.
3. `npm run dev`, submit Goals. Or alone: `vision/.venv/bin/python vision/facetime_trigger.py "circuits" "Google Chrome"`. Second arg is the sites/apps phrase.

## Gotchas
- Camera permission for the Python process. Screen Recording for OCR.
- `detector.py` resizes frames to 640×480 for `distraction_model.json`.
- `detector.py` also records clips on request (`ClipRecorder`; protocol: `../architecture/contracts.md#session-clips`). Needs no new packages. Expect ~1–3 MB per 30 s clip.
- Do not merge `webcam-activity-detection`'s root `04_screen_monitor.py` (Windows `winocr`, hardcoded key).
