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
| After merge: `vision/01_collect_data.py`, `02_train_model.py`, `03_detection_server.py`, `distraction_model.json` | From `webcam-activity-detection`; run from `vision/` (relative paths) |

## Inputs / Outputs
JSON line + `VisionState`: `../architecture/contracts.md#vision-sidecar`. Model features (order matters): `pitch, yaw, roll, nose_x_offset, nose_y_offset, left_eye_ratio, right_eye_ratio, shoulder_dist`, pixel space, face-mesh landmarks 1/152/33/263/159/145/386/374, pose 11/12.

## Run & test
1. `npm run setup:vision`.
2. Standalone: `vision/.venv/bin/python vision/detector.py --model vision/distraction_model.json` → ~1 line/s; look away → `distracted: true`; leave frame → `face: false`.
3. In app: `npm run dev`, submit Goals → `[vision]` logs; demo live view badges show `focus`.
Before the merge, test with `git show origin/webcam-activity-detection:distraction_model.json > /tmp/model.json` and `VISION_MODEL=/tmp/model.json npm run dev`.

## Merging `webcam-activity-detection`
1. `git merge origin/webcam-activity-detection`; `README.md` conflicts: keep main's.
2. `git mv 01_collect_data.py 02_train_model.py 03_detection_server.py distraction_model.json vision/`
3. `git rm 04_screen_monitor.py api_test.py` (Windows-only OCR + Gemini, hardcoded key).

## Current state
- Runtime ready; no model on `main` until the merge (`focus: 'off'`, reason "No webcam model yet").
- Not used for alerts, the Claude judge, or `ingest_signal` yet.
- `eyes` threshold (`EYES_CLOSED_BELOW = 0.008`) is a guess; tune with real data.

## Gotchas & don'ts
- Keep `features()` in `detector.py` identical to `01_collect_data.py`; changing one without retraining breaks the model.
- `mediapipe` ≥ 0.10.30 removed `mp.solutions`; don't bump without porting to MediaPipe Tasks.
- Pure-Python evaluator supports `binary:logistic` only; matched xgboost 3.4.1 `predict_proba` to 1.8e-7 on 2000 samples.
- Python child gets Electron's Camera permission only if asked first (`askForMediaAccess('camera')`).
- macOS allows the detector and LiveKit to use the camera at once.
