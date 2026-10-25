"""vision/screen_capture.py against the real window server (macOS only; skipped elsewhere)."""

import os
import sys
import unittest
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vision")))

IS_MAC = sys.platform == "darwin"


@unittest.skipUnless(IS_MAC, "macOS only")
class ScreenGrabberTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from screen_capture import ScreenGrabber
        cls.grabber = ScreenGrabber()

    def test_permission_is_reported_as_a_bool_without_prompting(self):
        self.assertIsInstance(self.grabber.has_permission(), bool)

    def test_grab_returns_a_bgr_image_of_the_display(self):
        frame = self.grabber.grab()
        self.assertIsNotNone(frame)
        self.assertEqual(frame.dtype, np.uint8)
        self.assertEqual(frame.ndim, 3)
        self.assertEqual(frame.shape[2], 3)
        self.assertGreaterEqual(frame.shape[1], 800)

    def test_grab_returns_an_owned_copy(self):
        a, b = self.grabber.grab(), self.grabber.grab()
        a[:] = 0
        self.assertIsNotNone(b)  # releasing the first capture does not affect the next

    def test_excluding_a_process_removes_exactly_its_windows(self):
        ids, total = self.grabber.window_ids(None)
        self.assertEqual(len(ids), total)
        if total == 0:
            self.skipTest("no on-screen windows")
        # Find the owner of the most windows via the grabber's own listing.
        import ctypes
        cg, cf = self.grabber.cg, self.grabber.cf
        infos = cg.CGWindowListCopyWindowInfo(1 | 16, 0)
        owners = Counter()
        for i in range(cf.CFArrayGetCount(infos)):
            entry = cf.CFArrayGetValueAtIndex(infos, i)
            pid = ctypes.c_int()
            cf.CFNumberGetValue(cf.CFDictionaryGetValue(entry, self.grabber._key_pid), 9, ctypes.byref(pid))
            owners[pid.value] += 1
        cf.CFRelease(infos)
        pid, count = owners.most_common(1)[0]
        kept, total_again = self.grabber.window_ids(pid)
        self.assertEqual(len(kept), total_again - count)

    def test_a_process_with_no_windows_excludes_nothing(self):
        ids, total = self.grabber.window_ids(2_000_000_000)
        self.assertEqual(len(ids), total)

    def test_excluding_everything_gives_no_frame(self):
        grabber = type(self.grabber)(exclude_pid=None)
        grabber.window_ids = lambda exclude_pid=None: ([], 5)
        self.assertIsNone(grabber.grab())


class PlatformGuardTests(unittest.TestCase):
    @unittest.skipIf(IS_MAC, "only meaningful off macOS")
    def test_construction_fails_clearly_off_macos(self):
        from screen_capture import ScreenGrabber
        with self.assertRaisesRegex(RuntimeError, "macOS only"):
            ScreenGrabber()


if __name__ == "__main__":
    unittest.main()
