"""Unit tests for vision/detector.py ClipRecorder and the stdin `clip <path>` reader.

mediapipe is stubbed (not needed for clipping); opencv + numpy must be installed (vision venv).
"""

import io
import os
import queue
import sys
import tempfile
import types
import unittest
from unittest import mock

import cv2
import numpy as np

sys.modules.setdefault("mediapipe", types.ModuleType("mediapipe"))
VISION = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision")
sys.path.insert(0, os.path.abspath(VISION))
import detector  # noqa: E402


def frame(label=0.0):
    img = np.zeros((480, 640, 3), np.uint8)
    cv2.putText(img, f"{label:.0f}", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 5)
    return img


class RecorderCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "clip.mp4")
        self.emitted = []
        patcher = mock.patch.object(detector, "emit", self.emitted.append)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = detector.ClipRecorder()

    def feed(self, start, end, step=0.15):
        """Add frames from `start` to `end` seconds on the monotonic clock; return the last `now`."""
        now = start
        while now < end:
            self.rec.add(frame(now), now)
            self.rec.tick(now)
            now += step
        return now

    def probe(self):
        cap = cv2.VideoCapture(self.path)
        self.addCleanup(cap.release)
        return {
            "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            "fps": cap.get(cv2.CAP_PROP_FPS),
            "w": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "h": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        }


class BufferTests(RecorderCase):
    def test_buffer_keeps_only_the_pre_window(self):
        self.feed(0, 60)
        span = self.rec.buffer[-1][0] - self.rec.buffer[0][0]
        self.assertLessEqual(span, detector.CLIP_PRE_SECS)
        self.assertGreater(span, detector.CLIP_PRE_SECS - 1)

    def test_buffered_frames_are_small_jpegs(self):
        self.rec.add(frame(), 0.0)
        _, jpg = self.rec.buffer[0]
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(img.shape[:2], (detector.CLIP_H, detector.CLIP_W))
        self.assertLess(len(jpg), 60_000)

    def test_no_job_means_nothing_is_written(self):
        self.feed(0, 40)
        self.rec.wait()
        self.assertEqual(self.emitted, [])


class ClipTests(RecorderCase):
    def record(self, step=0.15, trigger_at=100.0):
        self.feed(trigger_at - 30, trigger_at, step)
        self.rec.request(self.path, trigger_at)
        self.feed(trigger_at, trigger_at + detector.CLIP_POST_SECS + 1, step)
        self.rec.wait()
        return trigger_at

    def test_clip_is_30_seconds_ten_before_twenty_after(self):
        trigger = self.record()
        self.assertEqual(len(self.emitted), 1)
        msg = self.emitted[0]
        self.assertEqual(msg["clip"], self.path)
        self.assertAlmostEqual(msg["durationMs"] / 1000, 30, delta=0.6)
        pre = (msg["t"] - msg["startedAt"]) / 1000
        self.assertAlmostEqual(pre, detector.CLIP_PRE_SECS, delta=0.5)
        self.assertGreater(trigger, 0)

    def test_file_has_fixed_size_and_fps(self):
        self.record()
        info = self.probe()
        self.assertEqual((info["w"], info["h"]), (detector.CLIP_W, detector.CLIP_H))
        self.assertEqual(round(info["fps"]), detector.CLIP_FPS)
        self.assertAlmostEqual(info["frames"] / info["fps"], 30, delta=0.6)
        msg = self.emitted[0]
        self.assertEqual((msg["width"], msg["height"], msg["fps"]), (detector.CLIP_W, detector.CLIP_H, detector.CLIP_FPS))

    def test_constant_fps_even_with_a_slow_camera(self):
        self.record(step=0.5)  # 2 fps source
        self.assertAlmostEqual(self.probe()["frames"] / detector.CLIP_FPS, 30, delta=1.0)

    def test_gap_in_frames_still_covers_the_window(self):
        self.feed(70, 100)
        self.rec.request(self.path, 100.0)
        self.rec.add(frame(), 100.0)
        self.rec.add(frame(), 110.0)  # camera stalled 10 s
        self.feed(110, 121)
        self.rec.wait()
        self.assertAlmostEqual(self.emitted[0]["durationMs"] / 1000, 30, delta=0.6)

    def test_nothing_is_written_before_the_post_window_ends(self):
        self.feed(70, 100)
        self.rec.request(self.path, 100.0)
        self.feed(100, 110)
        self.rec.wait()
        self.assertEqual(self.emitted, [])
        self.assertFalse(os.path.exists(self.path))

    def test_second_request_while_recording_is_rejected(self):
        self.feed(70, 100)
        self.rec.request(self.path, 100.0)
        self.rec.request(os.path.join(self.dir.name, "other.mp4"), 101.0)
        self.assertEqual(self.emitted, [{"clip": None, "error": "busy"}])
        self.assertEqual(self.rec.job["path"], self.path)

    def test_new_request_allowed_after_the_clip_is_written(self):
        self.record()
        self.rec.request(os.path.join(self.dir.name, "second.mp4"), 200.0)
        self.assertIsNotNone(self.rec.job)

    def test_flush_writes_a_partial_clip_on_shutdown(self):
        self.feed(70, 100)
        self.rec.request(self.path, 100.0)
        self.feed(100, 105)
        self.rec.tick(105.0, flush=True)
        self.rec.wait()
        self.assertEqual(self.emitted[0]["clip"], self.path)
        self.assertAlmostEqual(self.emitted[0]["durationMs"] / 1000, 15, delta=0.6)

    def test_request_with_an_empty_buffer_reports_an_error(self):
        self.rec.request(self.path, 1.0)
        self.rec.tick(1.0, flush=True)
        self.rec.wait()
        self.assertIsNone(self.emitted[0]["clip"])
        self.assertIn("no frames", self.emitted[0]["error"])

    def test_unwritable_path_reports_an_error_instead_of_raising(self):
        self.rec.add(frame(), 0.0)
        self.rec.request(os.path.join(self.dir.name, "missing-dir", "x.mp4"), 0.0)
        self.rec.tick(0.0, flush=True)
        self.rec.wait()
        self.assertIsNone(self.emitted[0]["clip"])
        self.assertIn("error", self.emitted[0])

    def test_encoder_falls_back_to_mp4v(self):
        real = cv2.VideoWriter
        calls = []

        def fake_writer(path, fourcc, fps, size):
            calls.append(fourcc)
            if fourcc == cv2.VideoWriter_fourcc(*"avc1"):
                w = mock.Mock()
                w.isOpened.return_value = False
                return w
            return real(path, fourcc, fps, size)

        with mock.patch.object(cv2, "VideoWriter", side_effect=fake_writer):
            self.record()
        self.assertEqual(calls, [cv2.VideoWriter_fourcc(*"avc1"), cv2.VideoWriter_fourcc(*"mp4v")])
        self.assertEqual(self.emitted[0]["clip"], self.path)


class StdinTests(unittest.TestCase):
    def setUp(self):
        detector.stop.clear()
        while not detector.clip_requests.empty():
            detector.clip_requests.get()
        self.addCleanup(detector.stop.clear)

    def run_stdin(self, text):
        with mock.patch.object(sys, "stdin", io.StringIO(text)):
            detector.watch_stdin()
        out = []
        while True:
            try:
                out.append(detector.clip_requests.get_nowait())
            except queue.Empty:
                return out

    def test_clip_lines_are_queued_with_spaces_kept(self):
        self.assertEqual(self.run_stdin("clip /tmp/a b/c.mp4\nnoise\nclip /x.mp4\n"), ["/tmp/a b/c.mp4", "/x.mp4"])

    def test_other_lines_are_ignored(self):
        self.assertEqual(self.run_stdin("hello\nclipboard\n"), [])

    def test_eof_stops_the_detector(self):
        self.run_stdin("")
        self.assertTrue(detector.stop.is_set())


if __name__ == "__main__":
    unittest.main()
