"""Webcam-only clips (a teammate who joined a check-in): vision/clip_recorder.py `cam_only`, and the `clip-cam` stdin line."""

import io
import os
import queue
import sys
import types
import unittest
from unittest import mock

import cv2

from test_clip_recorder import GREEN, RecorderCase, solid, cr

sys.modules.setdefault("mediapipe", types.ModuleType("mediapipe"))
import detector  # noqa: E402

VISION = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision"))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("facetime_trigger_cam", os.path.join(VISION, "facetime_trigger.py"))
trigger = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(trigger)


class CamOnlyClipTests(RecorderCase):
    def record_cam_only(self, at=100.0, cam_img=None):
        self.feed(at - 30, at)  # whatever was on camera and screen before
        self.rec.request(self.path, at, cam_only=True)
        self.feed(at, at + cr.POST_SECS + 1, cam_img=cam_img)
        self.rec.wait()

    def test_records_only_from_the_request_on_at_the_cameras_own_size(self):
        self.record_cam_only(cam_img=solid(640, 480, GREEN))
        info = self.emitted[-1]
        self.assertEqual(info["clip"], self.path)
        self.assertEqual((info["width"], info["height"]), (640, 480))
        self.assertFalse(info["hasScreen"])
        self.assertAlmostEqual(info["durationMs"], cr.POST_SECS * 1000, delta=1500)  # no 10 s of pre-roll
        self.assertAlmostEqual(info["startedAt"], info["t"], delta=400)
        cap = self.frames_of()
        self.assertEqual((int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))), (640, 480))
        ok, frame = cap.read()
        self.assertTrue(ok)
        b, g, r = frame.mean(axis=(0, 1))  # the picture is the whole frame, no letterbox
        self.assertGreater(g, 150)
        self.assertLess(b + r, 100)

    def test_odd_camera_sizes_are_made_even_for_h264(self):
        self.record_cam_only(cam_img=solid(641, 479, GREEN))
        self.assertEqual((self.emitted[-1]["width"], self.emitted[-1]["height"]), (640, 478))

    def test_a_normal_request_is_unchanged(self):
        self.record()
        info = self.emitted[-1]
        self.assertEqual((info["width"], info["height"]), (cr.CANVAS_W, cr.CANVAS_H))
        self.assertTrue(info["hasScreen"])

    def test_every_reply_names_its_file_so_it_can_be_matched_to_its_request(self):
        self.record()
        self.assertEqual(self.emitted[-1]["path"], self.path)
        self.rec.request(os.path.join(self.dir.name, "a.mp4"), 200.0)
        self.rec.request(os.path.join(self.dir.name, "b.mp4"), 200.5, cam_only=True)  # busy
        self.assertEqual(self.emitted[-1], {"clip": None, "error": "busy", "path": os.path.join(self.dir.name, "b.mp4")})

    def test_a_failed_write_names_its_file_too(self):
        self.rec.request(self.path, 1.0, cam_only=True)
        self.rec.tick(1.0, flush=True)  # nothing buffered yet
        self.rec.wait()
        self.assertIsNone(self.emitted[-1]["clip"])
        self.assertEqual(self.emitted[-1]["path"], self.path)


class CamStdinTests(unittest.TestCase):
    def setUp(self):
        detector.stop.clear()
        while not detector.clip_requests.empty():
            detector.clip_requests.get()
        self.addCleanup(detector.stop.clear)

    def read(self, text):
        with mock.patch.object(sys, "stdin", io.StringIO(text)):
            detector.watch_stdin()
        out = []
        while True:
            try:
                out.append(detector.clip_requests.get_nowait())
            except queue.Empty:
                return out

    def test_clip_cam_lines_are_queued_as_webcam_only_with_spaces_kept(self):
        self.assertEqual(self.read("clip-cam /Application Support/x.mp4\nclip /a.mp4\n"), [("/Application Support/x.mp4", True), "/a.mp4"])


class CamForwardTests(unittest.TestCase):
    def test_clip_cam_lines_reach_the_detector_unchanged(self):
        proc = mock.Mock()
        trigger.stop.clear()
        with mock.patch.object(trigger, "_hard_exit"), mock.patch.object(sys, "stdin", io.StringIO("clip-cam /tmp/a b.mp4\n")):
            trigger.forward_clip_requests(proc)
        proc.stdin.write.assert_called_once_with(b"clip-cam /tmp/a b.mp4\n")
        trigger.stop.clear()
        trigger._stopping = False


if __name__ == "__main__":
    unittest.main()
