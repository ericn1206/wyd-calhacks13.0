"""vision/detector.py: the stdin `clip <path>` reader and the camera frame helper. mediapipe is stubbed."""

import io
import os
import queue
import sys
import types
import unittest
from unittest import mock

import numpy as np

sys.modules.setdefault("mediapipe", types.ModuleType("mediapipe"))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision")))
import detector  # noqa: E402


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


class ReadFrameTests(unittest.TestCase):
    def setUp(self):
        detector.stop.clear()
        self.addCleanup(detector.stop.clear)

    def test_returns_the_raw_frame_and_the_model_sized_one(self):
        cap = mock.Mock()
        raw = np.zeros((1080, 1920, 3), np.uint8)
        cap.read.return_value = (True, raw)
        got_raw, locked = detector.read_frame(cap)
        self.assertIs(got_raw, raw)
        self.assertEqual(raw.shape, (1080, 1920, 3))
        self.assertEqual(locked.shape, (detector.FRAME_H, detector.FRAME_W, 3))

    def test_gives_nothing_when_the_camera_stops(self):
        cap = mock.Mock()
        cap.read.return_value = (False, None)
        with mock.patch.object(detector, "pump"):
            self.assertEqual(detector.read_frame(cap), (None, None))


class ScreenSamplerStartTests(unittest.TestCase):
    def test_wyd_app_pid_is_passed_to_the_grabber(self):
        recorded = {}

        class FakeGrabber:
            def __init__(self, exclude_pid=None):
                recorded["pid"] = exclude_pid

            def has_permission(self):
                return True

            def grab(self):
                return None

        fake_module = types.ModuleType("screen_capture")
        fake_module.ScreenGrabber = FakeGrabber
        with mock.patch.dict(sys.modules, {"screen_capture": fake_module}), mock.patch.dict(os.environ, {"WYD_APP_PID": "4321"}):
            detector.stop.set()  # the sampler exits immediately
            self.addCleanup(detector.stop.clear)
            sampler = detector.start_screen_sampler(mock.Mock())
            sampler.join(timeout=2)
        self.assertEqual(recorded["pid"], 4321)

    def test_screen_recording_is_skipped_quietly_when_capture_cannot_load(self):
        fake_module = types.ModuleType("screen_capture")

        def broken(exclude_pid=None):
            raise RuntimeError("screen capture is macOS only")

        fake_module.ScreenGrabber = broken
        with mock.patch.dict(sys.modules, {"screen_capture": fake_module}):
            self.assertIsNone(detector.start_screen_sampler(mock.Mock()))


    def test_without_screen_recording_permission_clips_are_webcam_only_and_the_user_is_told(self):
        calls = []

        class DeniedGrabber:
            def __init__(self, exclude_pid=None):
                pass

            def has_permission(self):
                return False

            def request_permission(self):
                calls.append("prompted")
                return False

            def grab(self):  # macOS would return wallpaper-only frames here; they must never be recorded
                raise AssertionError("must not capture without permission")

        fake_module = types.ModuleType("screen_capture")
        fake_module.ScreenGrabber = DeniedGrabber
        err = io.StringIO()
        with mock.patch.dict(sys.modules, {"screen_capture": fake_module}), mock.patch.object(sys, "stderr", err):
            self.assertIsNone(detector.start_screen_sampler(mock.Mock()))
        self.assertEqual(calls, ["prompted"])
        self.assertIn("Screen Recording permission", err.getvalue())
        self.assertIn("webcam only", err.getvalue())


if __name__ == "__main__":
    unittest.main()
