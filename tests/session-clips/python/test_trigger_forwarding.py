"""Unit tests for the clip plumbing in vision/facetime_trigger.py (no camera, no Gemini)."""

import contextlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import time
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
        trigger._stopping = False
        self.addCleanup(trigger.stop.clear)
        self.addCleanup(setattr, trigger, "_stopping", False)
        patcher = mock.patch.object(trigger, "_hard_exit")  # stdin EOF starts the stop watchdog; never exit the test run
        self.hard_exit = patcher.start()
        self.addCleanup(patcher.stop)

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


class StopTests(unittest.TestCase):
    """The trigger must go away when the app does, even while the main loop is stuck in a network call."""

    def setUp(self):
        trigger.stop.clear()
        trigger._stopping = False
        self.addCleanup(trigger.stop.clear)
        self.addCleanup(setattr, trigger, "_stopping", False)
        self.addCleanup(setattr, trigger, "detector_proc", None)
        patcher = mock.patch.object(trigger, "_hard_exit")
        self.hard_exit = patcher.start()
        self.addCleanup(patcher.stop)

    def test_eof_on_stdin_means_the_app_is_gone_and_starts_the_stop(self):
        with mock.patch.object(sys, "stdin", io.StringIO("")):
            trigger.forward_clip_requests(FakeProc())
        self.assertTrue(trigger.stop.is_set())
        self.assertTrue(trigger._stopping)

    def test_watchdog_kills_the_detector_and_exits_after_the_grace_period(self):
        detector = mock.Mock()
        detector.poll.return_value = None
        trigger.detector_proc = detector
        trigger.request_stop(grace=0.05)
        time.sleep(0.4)
        detector.kill.assert_called_once()
        self.hard_exit.assert_called_once_with(0)

    def test_watchdog_leaves_an_already_finished_detector_alone(self):
        detector = mock.Mock()
        detector.poll.return_value = 0
        trigger.detector_proc = detector
        trigger.request_stop(grace=0.05)
        time.sleep(0.4)
        detector.kill.assert_not_called()
        self.hard_exit.assert_called_once_with(0)

    def test_stopping_twice_starts_one_watchdog(self):
        trigger.request_stop(grace=0.05)
        trigger.request_stop(grace=0.05)
        time.sleep(0.4)
        self.assertEqual(self.hard_exit.call_count, 1)

    def test_a_stop_without_a_detector_still_exits(self):
        trigger.request_stop(grace=0.05)
        time.sleep(0.4)
        self.hard_exit.assert_called_once_with(0)


STUCK_TRIGGER = """
import importlib.util, os, subprocess, sys, time
spec = importlib.util.spec_from_file_location("ft", os.path.join(%(vision)r, "facetime_trigger.py"))
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)
ft.STOP_GRACE_SEC = 1.0
ft.install_signal_handlers()
child = subprocess.Popen(["sleep", "60"])
ft.detector_proc = child
print("child", child.pid, flush=True)
if %(watch_stdin)r:
    import threading
    threading.Thread(target=ft.forward_clip_requests, args=(ft.detector_proc,), daemon=True).start()
time.sleep(60)  # the main loop stuck in a slow Gemini call
"""


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class RealProcessStopTests(unittest.TestCase):
    def start(self, watch_stdin):
        script = STUCK_TRIGGER % {"vision": VISION, "watch_stdin": watch_stdin}
        proc = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        child = int(proc.stdout.readline().split()[1])
        self.addCleanup(lambda: alive(child) and os.kill(child, 9))
        return proc, child

    def wait_gone(self, proc, child, seconds=8):
        deadline = time.time() + seconds
        while time.time() < deadline and (proc.poll() is None or alive(child)):
            time.sleep(0.1)

    def test_sigterm_ends_a_stuck_trigger_and_its_detector(self):
        proc, child = self.start(watch_stdin=False)
        proc.send_signal(signal.SIGTERM)
        self.wait_gone(proc, child)
        self.assertIsNotNone(proc.poll(), "trigger still running")
        self.assertFalse(alive(child), "detector still running")

    def test_closing_stdin_ends_a_stuck_trigger_and_its_detector(self):
        proc, child = self.start(watch_stdin=True)
        proc.stdin.close()  # Electron died
        self.wait_gone(proc, child)
        self.assertIsNotNone(proc.poll(), "trigger still running")
        self.assertFalse(alive(child), "detector still running")


if __name__ == "__main__":
    unittest.main()
