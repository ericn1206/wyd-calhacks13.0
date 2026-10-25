"""Session clips: a rolling buffer of the webcam and the screen, and the writer that turns it into one mp4.

Both streams are recorded locally on the laptop of the person who drifted (never taken from the LiveKit call).
A clip request freezes the last PRE_SECS, keeps recording for POST_SECS, then composes 1280x720 H.264 at CLIP_FPS:
screen full frame with the webcam as an inset (webcam full frame when there is no screen stream).
"""

import collections
import threading
import time

import cv2
import numpy as np

# Fixed output format, so the compiler (and anyone reading the metadata) can rely on it.
CANVAS_W, CANVAS_H, CLIP_FPS = 1280, 720, 10
PRE_SECS, POST_SECS = 10, 20
CAM_BUFFER_W = 640     # webcam frames are kept at most this wide (aspect kept)
PIP_W, PIP_MARGIN = 320, 20
JPEG_QUALITY = 80
SCREEN_FPS = 5


def _jpeg(img):
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return buf.tobytes() if ok else None


def _shrink(img, max_w, max_h):
    h, w = img.shape[:2]
    scale = min(max_w / w, max_h / h, 1.0)
    if scale >= 1.0:
        return img
    return cv2.resize(img, (max(2, int(w * scale)), max(2, int(h * scale))), interpolation=cv2.INTER_AREA)


def _paste_fit(canvas, img, x, y, w, h):
    """Scale `img` to fit the w×h box at (x, y), centred."""
    ih, iw = img.shape[:2]
    scale = min(w / iw, h / ih)
    nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    ox, oy = x + (w - nw) // 2, y + (h - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = resized


def compose(screen, cam):
    """One output frame. Either input may be None (not both)."""
    canvas = np.zeros((CANVAS_H, CANVAS_W, 3), np.uint8)
    if screen is None:
        _paste_fit(canvas, cam, 0, 0, CANVAS_W, CANVAS_H)
        return canvas
    _paste_fit(canvas, screen, 0, 0, CANVAS_W, CANVAS_H)
    if cam is not None:
        ch, cw = cam.shape[:2]
        pw, ph = PIP_W, max(2, int(ch * PIP_W / cw))
        x, y = CANVAS_W - pw - PIP_MARGIN, CANVAS_H - ph - PIP_MARGIN
        canvas[y:y + ph, x:x + pw] = cv2.resize(cam, (pw, ph), interpolation=cv2.INTER_AREA)
        cv2.rectangle(canvas, (x - 2, y - 2), (x + pw + 1, y + ph + 1), (255, 255, 255), 2)
    return canvas


class ClipRecorder:
    """Thread-safe: the camera loop calls add_cam, a sampler thread calls add_screen, the camera loop calls request/tick."""

    def __init__(self, emit):
        self.emit = emit
        self.lock = threading.Lock()
        self.cam = collections.deque()      # (monotonic s, jpeg bytes)
        self.screen = collections.deque()
        self.job = None  # {path, cam, screen, moment_mono, moment_ms, end_mono}
        self.writers = []

    def _add(self, ring, key, item):
        with self.lock:
            if self.job is not None:
                self.job[key].append(item)
            ring.append(item)
            while ring and item[0] - ring[0][0] > PRE_SECS:
                ring.popleft()

    def add_cam(self, frame, now):
        jpg = _jpeg(_shrink(frame, CAM_BUFFER_W, CAM_BUFFER_W))
        if jpg:
            self._add(self.cam, 'cam', (now, jpg))

    def add_screen(self, frame, now):
        jpg = _jpeg(_shrink(frame, CANVAS_W, CANVAS_H))
        if jpg:
            self._add(self.screen, 'screen', (now, jpg))

    def request(self, path, now):
        with self.lock:
            if self.job is not None:
                busy = True
            else:
                busy = False
                self.job = {
                    'path': path,
                    'cam': list(self.cam),
                    'screen': list(self.screen),
                    'moment_mono': now,
                    'moment_ms': int(time.time() * 1000),
                    'end_mono': now + POST_SECS,
                }
        if busy:
            self.emit({'clip': None, 'error': 'busy'})

    def tick(self, now, flush=False):
        with self.lock:
            job = self.job
            if job is None or (now < job['end_mono'] and not flush):
                return
            self.job = None
        thread = threading.Thread(target=self._write, args=(job,), daemon=False)
        self.writers.append(thread)
        thread.start()

    def wait(self):
        for thread in self.writers:
            thread.join(timeout=60)

    def _write(self, job):
        try:
            cam, screen = job['cam'], job['screen']
            if not cam and not screen:
                raise RuntimeError('no frames buffered')
            writer = None
            for code in ('avc1', 'mp4v'):
                writer = cv2.VideoWriter(job['path'], cv2.VideoWriter_fourcc(*code), CLIP_FPS, (CANVAS_W, CANVAS_H))
                if writer.isOpened():
                    break
                writer.release()
                writer = None
            if writer is None:
                raise RuntimeError('no mp4 encoder')
            streams = [s for s in (cam, screen) if s]
            first = min(s[0][0] for s in streams)
            last = max(s[-1][0] for s in streams)
            count = max(1, int((last - first) * CLIP_FPS) + 1)
            # Constant frame rate: tick k shows each stream's newest frame at or before first + k / CLIP_FPS.
            index = {'cam': 0, 'screen': 0}
            decoded = {}

            def current(name, frames, at):
                if not frames:
                    return None
                i = index[name]
                while i + 1 < len(frames) and frames[i + 1][0] <= at:
                    i += 1
                index[name] = i
                if decoded.get(name, (None, None))[0] != i:
                    decoded[name] = (i, cv2.imdecode(np.frombuffer(frames[i][1], np.uint8), cv2.IMREAD_COLOR))
                return decoded[name][1]

            for k in range(count):
                at = first + k / CLIP_FPS
                writer.write(compose(current('screen', screen, at), current('cam', cam, at)))
            writer.release()
            self.emit({
                'clip': job['path'],
                't': job['moment_ms'],
                'startedAt': job['moment_ms'] - int((job['moment_mono'] - first) * 1000),
                'durationMs': int(count * 1000 / CLIP_FPS),
                'width': CANVAS_W,
                'height': CANVAS_H,
                'fps': CLIP_FPS,
                'hasScreen': bool(screen),
            })
        except Exception as err:
            self.emit({'clip': None, 'error': f'{type(err).__name__}: {err}'})


class ScreenSampler(threading.Thread):
    """Feeds screen frames to the recorder at SCREEN_FPS until `stop` is set or the grabber keeps failing."""

    def __init__(self, recorder, grabber, stop, log=print):
        super().__init__(daemon=True)
        self.recorder, self.grabber, self.stop_event, self.log = recorder, grabber, stop, log

    def run(self):
        gap = 1 / SCREEN_FPS
        failures = 0
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                frame = self.grabber.grab()
            except Exception as err:
                frame = None
                self.log(f'screen capture error: {type(err).__name__}: {err}')
            if frame is None:
                failures += 1
                if failures >= 20:
                    self.log('screen capture keeps failing (Screen Recording permission?); clips will be webcam only')
                    return
            else:
                failures = 0
                self.recorder.add_screen(frame, time.monotonic())
            rest = gap - (time.monotonic() - started)
            if rest > 0 and self.stop_event.wait(rest):
                return
