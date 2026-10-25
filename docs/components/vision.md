# Webcam detector (vision)

## Purpose
Local webcam focus signal: face present, looking away (distracted), eyes. Frames stay in the Python process; only a JSON line per second leaves it.

## Files
| File | Role |
|---|---|
| `vision/detector.py` | Headless sidecar: MediaPipe face mesh + pose → 8 features → XGBoost JSON evaluated in pure Python → 20-frame mean |
| `vision/requirements.txt` / `requirements-train.txt` | Runtime pins / training extras (`../architecture/stack.md`) |
| `scripts/setup-vision.sh` | `npm run setup:vision`: creates `vision/.venv` (Python 3.12) + smoke import |
| `src/main/visionSidecar.ts` | `startVision(root, onUpdate)` / `stopVision()`: spawn, parse lines, restart with backoff (1→8 s, 5 tries) |
| `src/main/index.ts` | Asks Camera permission, starts on `wyd:tracking:start`, stops on quit |
| `src/main/activityMonitor.ts` | `setVision()` → `ActivityState.vision` |
| `vision/distraction_model.json` | Windows-trained XGBoost model. Frames are resized to 640×480 before the 8 features, which is the size those trees split on. |

## Inputs / Outputs
JSON line + `VisionState`: `../architecture/contracts.md#vision-sidecar`. Model features (order matters): `pitch, yaw, roll, nose_x_offset, nose_y_offset, left_eye_ratio, right_eye_ratio, shoulder_dist`, pixel space, face-mesh landmarks 1/152/33/263/159/145/386/374, pose 11/12.

## Run & test
1. `npm run setup:vision`.
2. Standalone: `vision/.venv/bin/python vision/detector.py --model vision/distraction_model.json` → ~1 line/s; look away → `distracted: true`; leave frame → `face: false`.
3. In app: `npm run dev`, submit Goals. Focus screen chip and the dock status follow `vision.focus` (green Focused, red Distracted, gray No face). Demo live view badges use the same value.

## Merging `webcam-activity-detection`
1. `git merge origin/webcam-activity-detection`; `README.md` conflicts: keep main's.
2. `git mv 01_collect_data.py 02_train_model.py 03_detection_server.py distraction_model.json vision/`
3. `git rm 04_screen_monitor.py api_test.py` (Windows-only OCR + Gemini, hardcoded key).

## Current state
- `vision/distraction_model.json` is the Windows-trained model. macOS cameras open larger (this machine: 1920×1080); `detector.py` resizes to 640×480 before features and pumps the CoreFoundation run loop so headless AVFoundation keeps frames.
- Focus screen chip + dock “On task / Off task” read `ActivityState.vision.focus`. Demo check-in still forces the dock to Off task.
- Not used for alerts, the Claude judge, or `ingest_signal` yet.
- `eyes` threshold (`EYES_CLOSED_BELOW = 0.008`) is a guess; tune with real data.
- If the chip stays green when you look away, retrain on this Mac (`01_collect_data.py` then `02_train_model.py` on `webcam-activity-detection`) and replace `vision/distraction_model.json`.

## Gotchas & don'ts
- Keep `features()` in `detector.py` identical to `01_collect_data.py`; changing one without retraining breaks the model.
- `mediapipe` ≥ 0.10.30 removed `mp.solutions`; don't bump without porting to MediaPipe Tasks.
- Pure-Python evaluator supports `binary:logistic` only; matched xgboost 3.4.1 `predict_proba` to 1.8e-7 on 2000 samples.
- Python child gets Electron's Camera permission only if asked first (`askForMediaAccess('camera')`).
- macOS allows the detector and LiveKit to use the camera at once.
- Do not `time.sleep` between captures. AVFoundation stops after one frame unless `CFRunLoopRunInMode` runs (`pump` in `detector.py`).
