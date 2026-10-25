"""Screen frames for session clips, macOS only, no extra packages (CoreGraphics through ctypes).

Captures the main display's on-screen windows at 1x resolution, leaving out every window owned by one
process (the WYD app: its overlay shows the live check-in tiles, which must not end up in the clip).
Needs the Screen Recording permission, like the OCR in 04_screen_monitor.py; without it other apps'
windows come back blank.
"""

import ctypes
import sys

import numpy as np

_ON_SCREEN_ONLY = 1
_EXCLUDE_DESKTOP = 16
_NOMINAL_RESOLUTION = 16
_BOUNDS_IGNORE_FRAMING = 1
_CF_SINT32 = 9
_UTF8 = 0x08000100


class _Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]


class _Size(ctypes.Structure):
    _fields_ = [("w", ctypes.c_double), ("h", ctypes.c_double)]


class _Rect(ctypes.Structure):
    _fields_ = [("origin", _Point), ("size", _Size)]


def _load():
    cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    vp, sz, i32, u32 = ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_uint32
    cf.CFArrayGetCount.restype, cf.CFArrayGetCount.argtypes = ctypes.c_long, [vp]
    cf.CFArrayGetValueAtIndex.restype, cf.CFArrayGetValueAtIndex.argtypes = vp, [vp, ctypes.c_long]
    cf.CFDictionaryGetValue.restype, cf.CFDictionaryGetValue.argtypes = vp, [vp, vp]
    cf.CFNumberGetValue.restype, cf.CFNumberGetValue.argtypes = ctypes.c_bool, [vp, i32, vp]
    cf.CFRelease.restype, cf.CFRelease.argtypes = None, [vp]
    cf.CFArrayCreate.restype, cf.CFArrayCreate.argtypes = vp, [vp, ctypes.POINTER(vp), ctypes.c_long, vp]
    cf.CFStringCreateWithCString.restype, cf.CFStringCreateWithCString.argtypes = vp, [vp, ctypes.c_char_p, u32]
    cf.CFDataGetBytePtr.restype, cf.CFDataGetBytePtr.argtypes = vp, [vp]
    cf.CFDataGetLength.restype, cf.CFDataGetLength.argtypes = ctypes.c_long, [vp]
    cg.CGWindowListCopyWindowInfo.restype, cg.CGWindowListCopyWindowInfo.argtypes = vp, [u32, u32]
    cg.CGWindowListCreateImageFromArray.restype = vp
    cg.CGWindowListCreateImageFromArray.argtypes = [_Rect, vp, u32]
    cg.CGMainDisplayID.restype = u32
    cg.CGDisplayBounds.restype, cg.CGDisplayBounds.argtypes = _Rect, [u32]
    for name in ("CGImageGetWidth", "CGImageGetHeight", "CGImageGetBytesPerRow"):
        fn = getattr(cg, name)
        fn.restype, fn.argtypes = sz, [vp]
    cg.CGImageGetDataProvider.restype, cg.CGImageGetDataProvider.argtypes = vp, [vp]
    cg.CGDataProviderCopyData.restype, cg.CGDataProviderCopyData.argtypes = vp, [vp]
    return cg, cf


class ScreenGrabber:
    """`grab()` → BGR uint8 array of the main display without `exclude_pid`'s windows, or None on failure."""

    def __init__(self, exclude_pid=None):
        if sys.platform != "darwin":
            raise RuntimeError("screen capture is macOS only")
        self.exclude_pid = exclude_pid
        self.cg, self.cf = _load()
        self._key_pid = self.cf.CFStringCreateWithCString(None, b"kCGWindowOwnerPID", _UTF8)
        self._key_num = self.cf.CFStringCreateWithCString(None, b"kCGWindowNumber", _UTF8)

    def window_ids(self, exclude_pid=None):
        """(ids of on-screen windows not owned by `exclude_pid`, total on-screen windows)."""
        cf = self.cf
        infos = self.cg.CGWindowListCopyWindowInfo(_ON_SCREEN_ONLY | _EXCLUDE_DESKTOP, 0)
        if not infos:
            return [], 0
        ids, total = [], 0
        try:
            for i in range(cf.CFArrayGetCount(infos)):
                entry = cf.CFArrayGetValueAtIndex(infos, i)
                pid, number = ctypes.c_int(), ctypes.c_int()
                if not cf.CFNumberGetValue(cf.CFDictionaryGetValue(entry, self._key_pid), _CF_SINT32, ctypes.byref(pid)):
                    continue
                if not cf.CFNumberGetValue(cf.CFDictionaryGetValue(entry, self._key_num), _CF_SINT32, ctypes.byref(number)):
                    continue
                total += 1
                if exclude_pid is None or pid.value != exclude_pid:
                    ids.append(number.value)
        finally:
            cf.CFRelease(infos)
        return ids, total

    def grab(self):
        cg, cf = self.cg, self.cf
        ids, _ = self.window_ids(self.exclude_pid)
        if not ids:
            return None
        buf = (ctypes.c_void_p * len(ids))(*ids)  # window ids stored as raw values, no CF callbacks
        window_array = cf.CFArrayCreate(None, buf, len(ids), None)
        if not window_array:
            return None
        try:
            image = cg.CGWindowListCreateImageFromArray(
                cg.CGDisplayBounds(cg.CGMainDisplayID()), window_array, _NOMINAL_RESOLUTION | _BOUNDS_IGNORE_FRAMING
            )
        finally:
            cf.CFRelease(window_array)
        if not image:
            return None
        try:
            width, height = cg.CGImageGetWidth(image), cg.CGImageGetHeight(image)
            stride = cg.CGImageGetBytesPerRow(image)
            if not width or not height:
                return None
            data = cg.CGDataProviderCopyData(cg.CGImageGetDataProvider(image))
            if not data:
                return None
            try:
                raw = (ctypes.c_ubyte * cf.CFDataGetLength(data)).from_address(cf.CFDataGetBytePtr(data))
                rows = np.frombuffer(raw, np.uint8, count=height * stride).reshape(height, stride // 4, 4)
                return rows[:, :width, :3].copy()  # BGRA → BGR, copied before the CFData is released
            finally:
                cf.CFRelease(data)
        finally:
            cf.CFRelease(image)
