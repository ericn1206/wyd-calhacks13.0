"""Unit tests for the clip plumbing in vision/facetime_trigger.py (no camera, no Gemini)."""

import contextlib
import importlib.util
import io
import json
import os
import sys
import unittest
from unittest import mock

VISION = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision"))
spec = importlib.util.spec_from_file_location("facetime_trigger", os.path.join(VISION, "facetime_trigger.py"))
trigger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trigger)


class FakeProc:
    def __init__(self, lines=()):
        self.stdout = [line.encode() + b"\n" for line in lines]
        self.stdin = mock.Mock()


class ReadWebcamTests(unittest.TestCase):
    def setUp(self):
        trigger.stop.clear()
        trigger.webcam_distracted = False
        trigger.saw_webcam = False
        trigger.webcam_last = {}
        self.addCleanup(trigger.stop.clear)

    def read(self, lines):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            trigger.read_webcam(FakeProc(lines))
        return out.getvalue()

    def test_clip_reply_is_reprinted_for_electron(self):
        reply = {"clip": "/tmp/x.mp4", "t": 5, "startedAt": 1, "durationMs": 30000, "width": 320, "height": 240, "fps": 8}
        out = self.read([json.dumps(reply)])
        self.assertEqual(out.strip(), "clip " + json.dumps(reply))

    def test_clip_reply_does_not_touch_the_webcam_vote(self):
        self.read([json.dumps({"face": True, "prob": 0.9, "distracted": True}), json.dumps({"clip": None, "error": "busy"})])
        self.assertTrue(trigger.webcam_distracted)
        self.assertEqual(trigger.webcam_last["prob"], 0.9)

    def test_normal_webcam_lines_are_not_printed(self):
        out = self.read([json.dumps({"face": True, "prob": 0.1, "distracted": False})])
        self.assertEqual(out, "")
        self.assertTrue(trigger.saw_webcam)

    def test_noise_lines_are_skipped(self):
        self.assertEqual(self.read(["not json", "{broken"]), "")


class ForwardTests(unittest.TestCase):
    def setUp(self):
        trigger.stop.clear()
        self.addCleanup(trigger.stop.clear)

    def forward(self, text, proc=None):
        proc = proc or FakeProc()
        with mock.patch.object(sys, "stdin", io.StringIO(text)):
            trigger.forward_clip_requests(proc)
        return proc

    def test_clip_lines_reach_the_detector_unchanged(self):
        proc = self.forward("clip /tmp/a b.mp4\n")
        proc.stdin.write.assert_called_once_with(b"clip /tmp/a b.mp4\n")
        proc.stdin.flush.assert_called_once()

    def test_other_lines_are_not_forwarded(self):
        proc = self.forward("face time\nstatus on\n")
        proc.stdin.write.assert_not_called()

    def test_nothing_is_forwarded_after_stop(self):
        trigger.stop.set()
        proc = self.forward("clip /x.mp4\n")
        proc.stdin.write.assert_not_called()

    def test_broken_pipe_ends_the_forwarder_quietly(self):
        proc = FakeProc()
        proc.stdin.write.side_effect = BrokenPipeError
        self.forward("clip /a.mp4\nclip /b.mp4\n", proc)
        self.assertEqual(proc.stdin.write.call_count, 1)


if __name__ == "__main__":
    unittest.main()
