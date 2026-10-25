# Distraction trigger

## Purpose
On Goals submit, run the webcam detector and the screen monitor. Print `face time` after two matching intervals.

## Files
| File | Role |
|---|---|
| `vision/detector.py` | Webcam. One JSON line/s. `distracted` is the webcam vote. From `webcam-activity`. |
| `vision/04_screen_monitor.py` | Screenshot → macOS Vision (`macos_vision_ocr.swift`) → Gemini. `ui_state["is_off_task"]` is the screen vote. |
| `vision/facetime_trigger.py` | Spawns `detector.py`, calls `check_once` each interval, prints `face time`. |
| `src/main/facetimeTrigger.ts` | Spawns the trigger on `wyd:tracking:start`. Stops on quit. |

## Rule
| Key | Value |
|---|---|
| Interval | 10 s |
| Screen path | `is_off_task` two intervals in a row. Webcam is ignored. |
| Webcam path | Screen on-task both intervals, and webcam `distracted` both intervals. |
| Fire | Either path prints `face time` once. Any other interval resets both streaks. |
| Not done | Does not open `.glass-video` / check-in popups. Those stay on the Demo menu. |

## Run
1. `npm run setup:vision`
2. `GEMINI_API_KEY` in `.env` or the environment. Without it the screen vote is unknown, so neither path can fire.
3. `npm run dev`, submit Goals. Or alone: `vision/.venv/bin/python vision/facetime_trigger.py "circuits"`.

## Gotchas
- Camera permission for the Python process. Screen Recording for OCR.
- `detector.py` resizes frames to 640×480 for `distraction_model.json`.
- Do not merge `webcam-activity-detection`'s root `04_screen_monitor.py` (Windows `winocr`, hardcoded key).
