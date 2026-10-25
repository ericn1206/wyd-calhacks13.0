#!/usr/bin/env bash
# Creates vision/.venv for the webcam detector. Usage: npm run setup:vision [-- --train]
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3.12}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3.12 not found. Install it (e.g. pyenv install 3.12 or brew install python@3.12), or set PYTHON=/path/to/python3.12." >&2
  exit 1
fi

"$PY" -m venv vision/.venv
vision/.venv/bin/python -m pip install --quiet --upgrade pip
REQS=vision/requirements.txt
if [[ "${1:-}" == "--train" ]]; then REQS=vision/requirements-train.txt; fi
vision/.venv/bin/pip install --quiet -r "$REQS"

vision/.venv/bin/python -c "import mediapipe as mp, cv2; mp.solutions.face_mesh.FaceMesh; mp.solutions.pose.Pose; print('vision ready: mediapipe', mp.__version__, 'opencv', cv2.__version__)"
