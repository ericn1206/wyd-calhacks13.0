"""Headless webcam focus detector, run as a sidecar by the Electron app (src/main/visionSidecar.ts).

Prints one JSON line per second to stdout:
  {"t": ms, "face": bool, "prob": 0-1, "distracted": bool, "yaw": f, "pitch": f, "eyes": "open"|"closed"}
Webcam and screen frames stay in memory (a rolling ~10 s of JPEGs, see clip_recorder.py) unless Electron asks
for a clip: a stdin line `clip <path>` writes the last 10 s plus the next 20 s to <path> as one 1280x720 H.264 mp4
(screen with the webcam inset; the WYD app's own windows, WYD_APP_PID, are left out of the screen) and prints
  {"clip": "<path>", "t": trigger ms, "startedAt": ms, "durationMs": n, "width": w, "height": h, "fps": n, "hasScreen": bool}
(or {"clip": null, "error": "..."}). Electron uploads the file and deletes it.
Exits on SIGTERM or when stdin closes (so it dies with the app).

Feature extraction must stay identical to 01_collect_data.py, or the model's inputs drift.
The XGBoost model is evaluated in pure Python, so xgboost (and libomp) is only needed to retrain.
"""

import argparse
import ctypes
import json
import math
import os
import queue
import signal
import sys
import threading
import time

import cv2
import mediapipe as mp
import numpy as np

from clip_recorder import ClipRecorder, ScreenSampler

HISTORY = 20             # frames averaged, as in 03_detection_server.py
DISTRACTED_ABOVE = 0.65  # as in 03_detection_server.py
EYES_CLOSED_BELOW = 0.008  # mean normalized lid gap; rough, tune with real data
FRAME_W, FRAME_H = 640, 480  # pixel size the Windows-trained model splits on

stop = threading.Event()
_runloop = None


def pump(seconds):
    """Turn the CoreFoundation run loop so AVFoundation keeps handing over frames.

    cv2.waitKey does this when a window is open. This sidecar has no window, and
    time.sleep lets the camera die after the first frame.
    """
    global _runloop
    if seconds <= 0:
        return
    try:
        if _runloop is None:
            lib = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            lib.CFRunLoopRunInMode.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_bool]
            lib.CFRunLoopRunInMode.restype = ctypes.c_int
            mode = ctypes.c_void_p.in_dll(lib, "kCFRunLoopDefaultMode")
            _runloop = (lib, mode)
        lib, mode = _runloop
        lib.CFRunLoopRunInMode(mode, float(seconds), False)
    except Exception:
        time.sleep(seconds)


def open_camera(index):
    cap = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        print(f'could not open camera {index} (check Camera permission)', file=sys.stderr)
        return None
    frame = None
    deadline = time.time() + 8
    while time.time() < deadline and not stop.is_set():
        ok, frame = cap.read()
        if ok and frame is not None and frame.size:
            break
        frame = None
        pump(0.2)
    if frame is None:
        cap.release()
        print(f'camera {index} returned no frames (check Camera permission)', file=sys.stderr)
        return None
    print(
        f'camera {index} delivered {frame.shape[1]}x{frame.shape[0]}; features locked to {FRAME_W}x{FRAME_H}',
        file=sys.stderr,
    )
    return cap


def lock_frame(frame):
    if frame.shape[1] != FRAME_W or frame.shape[0] != FRAME_H:
        return cv2.resize(frame, (FRAME_W, FRAME_H), interpolation=cv2.INTER_AREA)
    return frame


def read_frame(cap):
    """(camera frame as delivered, same frame locked to FRAME_W x FRAME_H), or (None, None)."""
    for _ in range(20):
        if stop.is_set():
            return None, None
        ok, frame = cap.read()
        if ok and frame is not None and frame.size:
            return frame, lock_frame(frame)
        pump(0.05)
    return None, None


class TreeModel:
    """Evaluates an XGBoost binary:logistic model saved with save_model(*.json)."""

    def __init__(self, path):
        with open(path) as f:
            learner = json.load(f)['learner']
        objective = learner['objective']['name']
        if objective != 'binary:logistic':
            raise ValueError(f'unsupported objective {objective}')
        base = float(learner['learner_model_param']['base_score'].strip('[]'))
        self.base_margin = math.log(base / (1 - base))
        self.trees = learner['gradient_booster']['model']['trees']
        self.feature_names = learner['feature_names']

    def prob(self, x):
        margin = self.base_margin
        for t in self.trees:
            left, right = t['left_children'], t['right_children']
            cond, idx, default_left = t['split_conditions'], t['split_indices'], t['default_left']
            n = 0
            while left[n] != -1:
                v = x[idx[n]]
                if v != v:  # NaN goes the default way
                    n = left[n] if default_left[n] else right[n]
                else:
                    n = left[n] if v < cond[n] else right[n]
            margin += cond[n]  # leaf value
        return 1 / (1 + math.exp(-margin))


def features(face_landmarks, pose_results, w, h):
    """Same 8 features, same order, as 01_collect_data.py."""
    nose = np.array([face_landmarks[1].x * w, face_landmarks[1].y * h])
    chin = np.array([face_landmarks[152].x * w, face_landmarks[152].y * h])
    left_eye = np.array([face_landmarks[33].x * w, face_landmarks[33].y * h])
    right_eye = np.array([face_landmarks[263].x * w, face_landmarks[263].y * h])
    face_center = (left_eye + right_eye) / 2

    pitch = chin[1] - nose[1]
    yaw = right_eye[0] - left_eye[0]
    roll = np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
    nose_x_offset = nose[0] - face_center[0]
    nose_y_offset = nose[1] - face_center[1]
    left_eye_ratio = abs(face_landmarks[159].y - face_landmarks[145].y)
    right_eye_ratio = abs(face_landmarks[386].y - face_landmarks[374].y)

    shoulder_dist = 0
    if pose_results.pose_landmarks:
        pose_landmarks = pose_results.pose_landmarks.landmark
        l_shoulder = np.array([pose_landmarks[11].x * w, pose_landmarks[11].y * h])
        r_shoulder = np.array([pose_landmarks[12].x * w, pose_landmarks[12].y * h])
        shoulder_center = (l_shoulder + r_shoulder) / 2
        shoulder_dist = np.linalg.norm(nose - shoulder_center)

    return [float(v) for v in (
        pitch, yaw, roll,
        nose_x_offset, nose_y_offset,
        left_eye_ratio, right_eye_ratio,
        shoulder_dist,
    )]


clip_requests = queue.Queue()


def watch_stdin():
    for line in sys.stdin:
        if line.startswith('clip '):
            clip_requests.put(line[5:].strip())
    stop.set()


def emit(payload):
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()


def start_screen_sampler(clips):
    """Record the screen for clips, leaving out the WYD app's own windows (WYD_APP_PID, set by Electron)."""
    try:
        from screen_capture import ScreenGrabber
        pid = os.environ.get('WYD_APP_PID')
        grabber = ScreenGrabber(exclude_pid=int(pid) if pid and pid.isdigit() else None)
    except Exception as err:
        print(f'screen recording off: {type(err).__name__}: {err}', file=sys.stderr)
        return None
    sampler = ScreenSampler(clips, grabber, stop, log=lambda m: print(m, file=sys.stderr))
    sampler.start()
    return sampler


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default=os.path.join(here, 'distraction_model.json'))
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--fps', type=float, default=10)
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    threading.Thread(target=watch_stdin, daemon=True).start()

    model = TreeModel(args.model)
    face_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
    pose = mp.solutions.pose.Pose()

    cap = open_camera(args.camera)
    if cap is None:
        return 2

    clips = ClipRecorder(emit)
    start_screen_sampler(clips)
    history = []
    frame_gap = 1 / max(1.0, args.fps)
    last_emit = 0.0
    face_seen = False
    last = {'yaw': 0.0, 'pitch': 0.0, 'eyes': 'open'}

    try:
        while not stop.is_set():
            started = time.monotonic()
            raw, frame = read_frame(cap)
            if frame is None:
                if stop.is_set():
                    break
                print('camera stopped returning frames', file=sys.stderr)
                return 3

            now = time.monotonic()
            clips.add_cam(raw, now)  # the camera's own frame, not the 640x480 one the model needs
            while not clip_requests.empty():
                clips.request(clip_requests.get(), now)
            clips.tick(now)

            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            face_results = face_mesh.process(rgb)
            if face_results.multi_face_landmarks:
                face_seen = True
                pose_results = pose.process(rgb)
                x = features(face_results.multi_face_landmarks[0].landmark, pose_results, w, h)
                history.append(model.prob(x))
                if len(history) > HISTORY:
                    history.pop(0)
                last = {
                    'yaw': round(x[1], 2),
                    'pitch': round(x[0], 2),
                    'eyes': 'closed' if (x[5] + x[6]) / 2 < EYES_CLOSED_BELOW else 'open',
                }

            now = time.monotonic()
            if now - last_emit >= 1:
                avg = float(np.mean(history)) if history else 0.0
                emit({
                    't': int(time.time() * 1000),
                    'face': face_seen,
                    'prob': round(avg, 3),
                    'distracted': face_seen and avg > DISTRACTED_ABOVE,
                    **last,
                })
                last_emit = now
                face_seen = False

            rest = frame_gap - (time.monotonic() - started)
            if rest > 0 and not stop.is_set():
                pump(rest)
    finally:
        cap.release()
        clips.tick(time.monotonic(), flush=True)
        clips.wait()
    return 0


if __name__ == '__main__':
    sys.exit(main())
