"""Unit tests for vision/clip_recorder.py: the rolling webcam + screen buffer, the 1280x720 composite, the sampler.

Needs opencv + numpy (the vision venv). No camera, no screen, no mediapipe.
"""

import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

import cv2
import numpy as np

VISION = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision"))
sys.path.insert(0, VISION)
import clip_recorder as cr  # noqa: E402

GREEN = (0, 200, 0)   # BGR
BLUE = (200, 40, 0)


def solid(w, h, bgr):
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = bgr
    return img


def labelled(w, h, n):
    img = solid(w, h, (30, 30, 30))
    cv2.putText(img, f"{n:.0f}", (50, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 5)
    return img


class RecorderCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "clip.mp4")
        self.emitted = []
        self.rec = cr.ClipRecorder(self.emitted.append)

    def feed(self, start, end, step=0.15, cam=True, screen=True, screen_step=0.2, cam_img=None, screen_img=None):
        """Add webcam and screen frames between two monotonic times, ticking the recorder; returns the last time."""
        now, next_screen = start, start
        while now < end:
            if cam:
                self.rec.add_cam(cam_img if cam_img is not None else labelled(640, 360, now), now)
            if screen and now >= next_screen:
                self.rec.add_screen(screen_img if screen_img is not None else labelled(1440, 932, now), now)
                next_screen += screen_step
            self.rec.tick(now)
            now += step
        return now

    def frames_of(self, path=None):
        cap = cv2.VideoCapture(path or self.path)
        self.addCleanup(cap.release)
        return cap

    def frame_at(self, index):
        cap = self.frames_of()
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = cap.read()
        self.assertTrue(ok)
        return frame

    def record(self, trigger_at=100.0, **kwargs):
        self.feed(trigger_at - 30, trigger_at, **kwargs)
        self.rec.request(self.path, trigger_at)
        self.feed(trigger_at, trigger_at + cr.POST_SECS + 1, **kwargs)
        self.rec.wait()
        return trigger_at


class BufferTests(RecorderCase):
    def test_both_buffers_keep_only_the_pre_window(self):
        self.feed(0, 60)
        for ring in (self.rec.cam, self.rec.screen):
            span = ring[-1][0] - ring[0][0]
            self.assertLessEqual(span, cr.PRE_SECS)
            self.assertGreater(span, cr.PRE_SECS - 1)

    def test_webcam_frames_keep_their_aspect_and_are_capped_in_width(self):
        self.rec.add_cam(solid(1920, 1080, GREEN), 0.0)
        img = cv2.imdecode(np.frombuffer(self.rec.cam[0][1], np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(img.shape[:2], (360, 640))

    def test_screen_frames_are_fitted_into_the_canvas(self):
        self.rec.add_screen(solid(2880, 1864, BLUE), 0.0)
        img = cv2.imdecode(np.frombuffer(self.rec.screen[0][1], np.uint8), cv2.IMREAD_COLOR)
        self.assertLessEqual(img.shape[1], cr.CANVAS_W)
        self.assertLessEqual(img.shape[0], cr.CANVAS_H)
        self.assertAlmostEqual(img.shape[1] / img.shape[0], 2880 / 1864, delta=0.02)

    def test_small_screen_frames_are_not_upscaled(self):
        self.rec.add_screen(solid(800, 500, BLUE), 0.0)
        img = cv2.imdecode(np.frombuffer(self.rec.screen[0][1], np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(img.shape[:2], (500, 800))

    def test_no_request_means_nothing_is_written(self):
        self.feed(0, 40)
        self.rec.wait()
        self.assertEqual(self.emitted, [])


class ClipTests(RecorderCase):
    def test_clip_is_30_seconds_ten_before_twenty_after(self):
        self.record()
        self.assertEqual(len(self.emitted), 1)
        msg = self.emitted[0]
        self.assertEqual(msg["clip"], self.path)
        self.assertAlmostEqual(msg["durationMs"] / 1000, 30, delta=0.6)
        self.assertAlmostEqual((msg["t"] - msg["startedAt"]) / 1000, cr.PRE_SECS, delta=0.5)

    def test_file_is_1280x720_at_the_fixed_rate_and_says_so(self):
        self.record()
        cap = self.frames_of()
        self.assertEqual((int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))), (1280, 720))
        self.assertEqual(round(cap.get(cv2.CAP_PROP_FPS)), cr.CLIP_FPS)
        self.assertAlmostEqual(cap.get(cv2.CAP_PROP_FRAME_COUNT) / cr.CLIP_FPS, 30, delta=0.6)
        msg = self.emitted[0]
        self.assertEqual((msg["width"], msg["height"], msg["fps"], msg["hasScreen"]), (1280, 720, 10, True))

    def test_screen_is_the_picture_and_the_webcam_an_inset_bottom_right(self):
        self.record(cam_img=solid(640, 360, GREEN), screen_img=solid(1440, 900, BLUE))
        frame = self.frame_at(150)
        centre = frame[360, 400].astype(int)
        inset = frame[600, 1100].astype(int)
        self.assertLess(np.abs(centre - np.array(BLUE)).max(), 40, f"centre {centre}")
        self.assertLess(np.abs(inset - np.array(GREEN)).max(), 40, f"inset {inset}")

    def test_a_16_by_10_screen_is_letterboxed_not_stretched(self):
        self.record(screen_img=solid(1440, 900, BLUE), cam_img=solid(640, 360, GREEN))
        frame = self.frame_at(150)  # 1440x900 fitted into 1280x720 = 1152x720: 64 px bars left and right
        self.assertLess(frame[300, 20].astype(int).max(), 30, "left bar is black")
        self.assertLess(np.abs(frame[300, 640].astype(int) - np.array(BLUE)).max(), 40)

    def test_without_a_screen_stream_the_webcam_fills_the_frame(self):
        self.record(screen=False, cam_img=solid(1280, 720, GREEN))
        self.assertFalse(self.emitted[0]["hasScreen"])
        frame = self.frame_at(150)
        self.assertLess(np.abs(frame[360, 640].astype(int) - np.array(GREEN)).max(), 40)
        self.assertLess(np.abs(frame[650, 1200].astype(int) - np.array(GREEN)).max(), 40, "no inset, just the webcam")

    def test_without_a_webcam_stream_the_screen_alone_is_recorded(self):
        self.record(cam=False, screen_img=solid(1280, 720, BLUE))
        self.assertTrue(self.emitted[0]["hasScreen"])
        self.assertLess(np.abs(self.frame_at(150)[650, 1200].astype(int) - np.array(BLUE)).max(), 40, "no inset")

    def test_constant_fps_even_with_a_slow_camera_and_screen(self):
        self.record(step=0.5, screen_step=1.0)
        # frames arrive every 0.5-1 s, so the clip runs to the last frame, up to ~1 s past the 30 s window
        self.assertAlmostEqual(self.frames_of().get(cv2.CAP_PROP_FRAME_COUNT) / cr.CLIP_FPS, 30, delta=2.0)

    def test_gap_in_frames_still_covers_the_window(self):
        self.feed(70, 100)
        self.rec.request(self.path, 100.0)
        self.rec.add_cam(labelled(640, 360, 1), 100.0)
        self.rec.add_cam(labelled(640, 360, 2), 110.0)  # camera and screen stalled 10 s
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
        other = os.path.join(self.dir.name, "other.mp4")
        self.rec.request(other, 101.0)
        self.assertEqual(self.emitted, [{"clip": None, "error": "busy", "path": other}])
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

    def test_request_with_empty_buffers_reports_an_error(self):
        self.rec.request(self.path, 1.0)
        self.rec.tick(1.0, flush=True)
        self.rec.wait()
        self.assertIsNone(self.emitted[0]["clip"])
        self.assertIn("no frames", self.emitted[0]["error"])

    def test_unwritable_path_reports_an_error_instead_of_raising(self):
        self.rec.add_cam(labelled(640, 360, 0), 0.0)
        self.rec.request(os.path.join(self.dir.name, "missing-dir", "x.mp4"), 0.0)
        self.rec.tick(0.0, flush=True)
        self.rec.wait()
        self.assertIsNone(self.emitted[0]["clip"])
        self.assertIn("error", self.emitted[0])

    def test_encoder_falls_back_to_mp4v(self):
        real, calls = cv2.VideoWriter, []

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

    def test_frames_added_from_two_threads_all_land(self):
        def screens():
            for i in range(200):
                self.rec.add_screen(solid(640, 400, BLUE), i * 0.02)

        thread = threading.Thread(target=screens)
        thread.start()
        for i in range(200):
            self.rec.add_cam(solid(320, 180, GREEN), i * 0.02)
        thread.join()
        # all 200 frames of each stream span 4 s, well inside the 10 s window, so none may be lost
        self.assertEqual(len(self.rec.cam), 200)
        self.assertEqual(len(self.rec.screen), 200)


class ComposeTests(unittest.TestCase):
    def test_compose_has_the_fixed_canvas_size(self):
        self.assertEqual(cr.compose(solid(100, 100, BLUE), None).shape, (720, 1280, 3))
        self.assertEqual(cr.compose(None, solid(100, 100, GREEN)).shape, (720, 1280, 3))
        self.assertEqual(cr.compose(solid(100, 100, BLUE), solid(100, 100, GREEN)).shape, (720, 1280, 3))

    def test_inset_has_a_white_border_and_sits_inside_the_margin(self):
        out = cr.compose(solid(1280, 720, BLUE), solid(640, 360, GREEN))
        x, y = 1280 - cr.PIP_W - cr.PIP_MARGIN, 720 - 180 - cr.PIP_MARGIN
        self.assertTrue((out[y + 90, x - 2] == 255).all(), "border left of the inset")
        self.assertTrue((out[y + 90, x + 10] == np.array(GREEN)).all())
        self.assertTrue((out[10, 10] == np.array(BLUE)).all())


class FakeGrabber:
    def __init__(self, frames):
        self.frames, self.calls = list(frames), 0

    def grab(self):
        self.calls += 1
        item = self.frames.pop(0) if self.frames else None
        if isinstance(item, Exception):
            raise item
        return item


class SamplerTests(unittest.TestCase):
    def run_sampler(self, grabber, seconds):
        rec = cr.ClipRecorder(lambda m: None)
        logs, stop = [], threading.Event()
        sampler = cr.ScreenSampler(rec, grabber, stop, log=logs.append)
        sampler.start()
        time.sleep(seconds)
        stop.set()
        sampler.join(timeout=3)
        return rec, logs, sampler

    def test_feeds_the_recorder_at_about_the_screen_rate(self):
        rec, _, sampler = self.run_sampler(FakeGrabber([solid(640, 400, BLUE)] * 1000), 2.1)
        self.assertFalse(sampler.is_alive())
        self.assertTrue(abs(len(rec.screen) - 2.1 * cr.SCREEN_FPS) <= 3, len(rec.screen))

    def test_stops_promptly_when_asked(self):
        _, _, sampler = self.run_sampler(FakeGrabber([solid(64, 40, BLUE)] * 1000), 0.3)
        self.assertFalse(sampler.is_alive())

    def test_a_failed_grab_is_skipped_and_the_next_one_works(self):
        rec, logs, _ = self.run_sampler(FakeGrabber([None, None, solid(640, 400, BLUE)] + [solid(640, 400, BLUE)] * 50), 1.0)
        self.assertGreaterEqual(len(rec.screen), 3)
        self.assertEqual(logs, [])

    def test_exceptions_are_logged_and_do_not_kill_the_sampler(self):
        rec, logs, _ = self.run_sampler(FakeGrabber([RuntimeError("boom")] + [solid(640, 400, BLUE)] * 50), 1.0)
        self.assertTrue(any("boom" in m for m in logs))
        self.assertGreaterEqual(len(rec.screen), 2)

    def test_gives_up_with_a_message_after_20_failures_in_a_row(self):
        with mock.patch.object(cr, "SCREEN_FPS", 200):
            rec, logs, sampler = self.run_sampler(FakeGrabber([]), 1.0)
        self.assertFalse(sampler.is_alive())
        self.assertEqual(len(rec.screen), 0)
        self.assertTrue(any("webcam only" in m for m in logs))


if __name__ == "__main__":
    unittest.main()
