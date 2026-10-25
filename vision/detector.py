"""Headless webcam focus detector, run as a sidecar by the Electron app (src/main/visionSidecar.ts).

Prints one JSON line per second to stdout:
  {"t": ms, "face": bool, "prob": 0-1, "distracted": bool, "yaw": f, "pitch": f, "eyes": "open"|"closed"}
Frames stay in memory (a rolling ~10 s of small JPEGs) unless Electron asks for a clip: a stdin line
`clip <path>` writes the last CLIP_PRE_SECS plus the next CLIP_POST_SECS to <path> as H.264 mp4 and prints
  {"clip": "<path>", "t": trigger ms, "startedAt": ms, "durationMs": n, "width": w, "height": h, "fps": n}
(or {"clip": null, "error": "..."}). Electron uploads the file and deletes it.
Exits on SIGTERM or when stdin closes (so it dies with the app).

Feature extraction must stay identical to 01_collect_data.py, or the model's inputs drift.
The XGBoost model is evaluated in pure Python, so xgboost (and libomp) is only needed to retrain.
"""

import argparse
import collections
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

HISTORY = 20             # frames averaged, as in 03_detection_server.py
DISTRACTED_ABOVE = 0.65  # as in 03_detection_server.py
EYES_CLOSED_BELOW = 0.008  # mean normalized lid gap; rough, tune with real data
FRAME_W, FRAME_H = 640, 480  # pixel size the Windows-trained model splits on
# Clip format is fixed so the clips of a session can be joined with ffmpeg `-c copy`.
CLIP_W, CLIP_H, CLIP_FPS = 320, 240, 8
CLIP_PRE_SECS, CLIP_POST_SECS = 10, 20
CLIP_JPEG_QUALITY = 70

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
    for _ in range(20):
        if stop.is_set():
            return None
        ok, frame = cap.read()
        if ok and frame is not None and frame.size:
            return lock_frame(frame)
        pump(0.05)
    return None


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


class ClipRecorder:
    """Keeps the last CLIP_PRE_SECS of small JPEG frames; a request adds CLIP_POST_SECS, then writes the mp4."""

    def __init__(self):
        self.buffer = collections.deque()  # (monotonic s, jpeg bytes)
        self.job = None  # {path, frames, moment_mono, moment_ms, end_mono}
        self.writers = []

    def add(self, frame, now):
        small = cv2.resize(frame, (CLIP_W, CLIP_H), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, CLIP_JPEG_QUALITY])
        if not ok:
            return
        item = (now, jpg.tobytes())
        if self.job is not None:
            self.job['frames'].append(item)
        self.buffer.append(item)
        while self.buffer and now - self.buffer[0][0] > CLIP_PRE_SECS:
            self.buffer.popleft()

    def request(self, path, now):
        if self.job is not None:
            emit({'clip': None, 'error': 'busy'})
            return
        self.job = {
            'path': path,
            'frames': list(self.buffer),
            'moment_mono': now,
            'moment_ms': int(time.time() * 1000),
            'end_mono': now + CLIP_POST_SECS,
        }

    def tick(self, now, flush=False):
        job = self.job
        if job is None or (now < job['end_mono'] and not flush):
            return
        self.job = None
        t = threading.Thread(target=self._write, args=(job,), daemon=False)
        self.writers.append(t)
        t.start()

    def wait(self):
        for t in self.writers:
            t.join(timeout=15)

    @staticmethod
    def _write(job):
        try:
            frames = job['frames']
            if not frames:
                raise RuntimeError('no frames buffered')
            writer = None
            for code in ('avc1', 'mp4v'):
                writer = cv2.VideoWriter(job['path'], cv2.VideoWriter_fourcc(*code), CLIP_FPS, (CLIP_W, CLIP_H))
                if writer.isOpened():
                    break
                writer.release()
                writer = None
            if writer is None:
                raise RuntimeError('no mp4 encoder')
            # Constant frame rate: tick k shows the newest frame at or before first + k / CLIP_FPS.
            first, last = frames[0][0], frames[-1][0]
            count = max(1, int((last - first) * CLIP_FPS) + 1)
            j = 0
            for k in range(count):
                at = first + k / CLIP_FPS
                while j + 1 < len(frames) and frames[j + 1][0] <= at:
                    j += 1
                img = cv2.imdecode(np.frombuffer(frames[j][1], np.uint8), cv2.IMREAD_COLOR)
                writer.write(img)
            writer.release()
            emit({
                'clip': job['path'],
                't': job['moment_ms'],
                'startedAt': job['moment_ms'] - int((job['moment_mono'] - first) * 1000),
                'durationMs': int(count * 1000 / CLIP_FPS),
                'width': CLIP_W,
                'height': CLIP_H,
                'fps': CLIP_FPS,
            })
        except Exception as err:
            emit({'clip': None, 'error': f'{type(err).__name__}: {err}'})


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

    clips = ClipRecorder()
    history = []
    frame_gap = 1 / max(1.0, args.fps)
    last_emit = 0.0
    face_seen = False
    last = {'yaw': 0.0, 'pitch': 0.0, 'eyes': 'open'}

    try:
        while not stop.is_set():
            started = time.monotonic()
            frame = read_frame(cap)
            if frame is None:
                if stop.is_set():
                    break
                print('camera stopped returning frames', file=sys.stderr)
                return 3

            now = time.monotonic()
            clips.add(frame, now)
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
