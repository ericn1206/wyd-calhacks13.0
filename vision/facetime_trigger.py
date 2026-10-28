"""Start the webcam detector and the screen monitor, then print face time.

An interval is 5 seconds. Print face time when either streak hits 2:
1. The classifier (Ollama tev1 by default, or Gemini) says the OCR text is off the study goal, twice in a row (webcam is ignored). The front app and named sites are context, not a hard block.
2. Screen looks on-task both intervals, and the webcam distracted both times.

Electron stdin `clip <path>` is passed to the detector, which records 10 s before to 20 s after
and writes an mp4. The detector's `{"clip": ...}` reply goes to stdout as `clip {...}`.
"""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTERVAL_SEC = 5
STREAK_TO_FIRE = 2

stop = threading.Event()
STOP_GRACE_SEC = 4.0
screen_module = None  # the loaded 04_screen_monitor, so a `classifier <name>` stdin line can switch it
detector_proc = None  # the webcam detector child, so the watchdog can kill it
_stopping = False
_hard_exit = os._exit  # patched in tests
lock = threading.Lock()
webcam_distracted = False
saw_webcam = False
webcam_last = {}  # latest detector.py JSON line, for the debug output


def frontmost_app():
    proc = subprocess.run(
        ["osascript", "-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
        capture_output=True,
        text=True,
        timeout=3,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def load_screen():
    path = os.path.join(HERE, "04_screen_monitor.py")
    spec = importlib.util.spec_from_file_location("screen_monitor", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def dbg(msg):
    """Timestamped stderr line for tracing clips and shutdown (grep `[clipdbg]`)."""
    print(f'[clipdbg] {time.strftime("%H:%M:%S")}.{int(time.time() * 1000) % 1000:03d} trigger: {msg}', file=sys.stderr, flush=True)


def read_webcam(proc):
    global webcam_distracted, saw_webcam, webcam_last
    if proc.stdout is None:
        return
    for line in proc.stdout:
        text = line.decode("utf-8", "replace").strip()
        if not text.startswith("{"):
            continue
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            continue
        if "clip" in msg:
            dbg(f'relaying detector reply to Electron: {json.dumps(msg)}')
            print("clip " + json.dumps(msg), flush=True)
            continue
        with lock:
            saw_webcam = True
            webcam_distracted = bool(msg.get("distracted"))
            webcam_last = msg
        if stop.is_set():
            break


def request_stop(grace=None):
    """Ask the main loop to finish. It can be stuck in a slow network call (Gemini), so after `grace` seconds a
    watchdog kills the webcam detector and exits regardless: nothing may keep the camera and screen capture
    running after the app is gone."""
    global _stopping
    dbg(f'request_stop (already stopping={_stopping}), watchdog {STOP_GRACE_SEC if grace is None else grace}s')
    stop.set()
    if _stopping:
        return
    _stopping = True
    wait = STOP_GRACE_SEC if grace is None else grace
    exit_now = _hard_exit  # bound now, so a later change of the module attribute cannot redirect a pending watchdog

    def watchdog():
        time.sleep(wait)
        proc = detector_proc
        alive = proc is not None and proc.poll() is None
        dbg(f'watchdog fired after {wait}s: detector still running={alive}; killing it and exiting (an unflushed clip is lost)')
        if alive:
            proc.kill()
        exit_now(0)

    threading.Thread(target=watchdog, daemon=True).start()


def install_signal_handlers():
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda *_: request_stop())


def forward_clip_requests(proc):
    """Pass `clip <path>` lines from Electron on to the detector. stdin closing means Electron is gone: stop."""
    for line in sys.stdin:
        if line.startswith("classifier ") and screen_module is not None:
            screen_module.set_classifier(line.split(None, 1)[1].strip())  # Demo menu switch, no restart
            continue
        if not line.startswith(("clip ", "clip-cam ")) or stop.is_set():
            dbg(f'dropped stdin line (stopping={stop.is_set()}): {line.strip()[:80]}')
            continue
        dbg(f'forwarding to detector: {line.strip()}')
        try:
            if proc.stdin is not None:
                proc.stdin.write(line.encode())
                proc.stdin.flush()
        except (BrokenPipeError, ValueError, OSError):
            dbg('detector stdin is gone; clip request lost')
            return
    dbg('Electron closed stdin')
    request_stop()


def screen_vote(screen, goal, sites):
    """'off' is a screen hit. 'ok' is on-task. 'unknown' is blank or an error.

    The selected classifier (Ollama tev1 or Gemini) decides from the OCR text. The front app and the sites/apps the user mentioned are
    passed as context only (not a strict allowlist), so e.g. Google Calendar can still be on task.
    """
    if screen is None:
        return "unknown"
    try:
        front = frontmost_app()
    except (OSError, subprocess.TimeoutExpired):
        front = ""
    context = "; ".join(part for part in (
        f"front app is {front}" if front else "",
        f"they said they would use: {sites}" if sites.strip() else "",
    ) if part)
    screen.check_once(goal, context)
    reason = str(screen.ui_state.get("reason", ""))
    if reason == "Screen mostly desktop/blank" or reason.startswith("Error:"):
        return "unknown"
    return "off" if screen.ui_state.get("is_off_task") else "ok"


def main():
    goal = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].strip() else "study"
    sites = sys.argv[2] if len(sys.argv) > 2 else ""
    install_signal_handlers()

    global detector_proc
    detector = os.path.join(HERE, "detector.py")
    model = os.path.join(HERE, "distraction_model.json")
    proc = detector_proc = subprocess.Popen(
        [sys.executable, detector, "--model", model],
        cwd=os.path.dirname(HERE),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,
    )
    threading.Thread(target=read_webcam, args=(proc,), daemon=True).start()
    threading.Thread(target=forward_clip_requests, args=(proc,), daemon=True).start()

    global screen_module
    screen = None
    try:
        screen = screen_module = load_screen()
        screen.set_classifier(os.environ.get("WYD_CLASSIFIER", "ollama"))
        screen.ensure_ocr()
    except SystemExit as err:
        print(f"screen monitor off: {err}", file=sys.stderr)
        screen = None
    except Exception as err:
        print(f"screen monitor off: {type(err).__name__}: {err}", file=sys.stderr)
        screen = None

    screen_streak = 0
    cam_streak = 0
    fired = False
    print("face time trigger on: screen off-task x2, or screen ok + webcam distracted x2", file=sys.stderr)
    try:
        while not stop.is_set():
            started = time.monotonic()
            vote = "unknown"
            try:
                vote = screen_vote(screen, goal, sites)
            except Exception as err:
                print(f"screen check failed: {type(err).__name__}: {err}", file=sys.stderr)
                vote = "unknown"
            with lock:
                cam_off = saw_webcam and webcam_distracted
                cam_seen = saw_webcam
                cam = dict(webcam_last)
            if vote == "off":
                screen_streak += 1
                cam_streak = 0
            elif vote == "ok" and cam_off:
                screen_streak = 0
                cam_streak += 1
            else:
                screen_streak = 0
                cam_streak = 0
            hot = screen_streak >= STREAK_TO_FIRE or cam_streak >= STREAK_TO_FIRE
            # This interval's verdict for the status dots (Electron reports it to SpacetimeDB).
            status = "off" if vote == "off" or (vote == "ok" and cam_off) else "on" if vote == "ok" else "none"
            if status != "none":
                print(f"status {status}", flush=True)
            # One JSON line per interval for the dock debug strip and the in-app detector log.
            debug = {
                "status": status,
                "screen": vote,
                "reason": str(screen.ui_state.get("reason", "")) if screen is not None else "screen monitor off",
                "ocrChars": int(screen.ui_state.get("ocr_chars", 0)) if screen is not None else 0,
                "webcam": ("distracted" if cam_off else "focused") if cam_seen else "none",
                "face": bool(cam.get("face", False)),
                "prob": round(float(cam.get("prob", 0.0)), 3),
                "screenStreak": screen_streak,
                "camStreak": cam_streak,
            }
            print("debug " + json.dumps(debug), flush=True)
            print(
                f"interval screen={vote} webcam={cam_off} screen_streak={screen_streak} cam_streak={cam_streak}",
                file=sys.stderr,
            )
            if hot and not fired:
                print("face time", flush=True)
                fired = True
            if not hot:
                fired = False
            rest = INTERVAL_SEC - (time.monotonic() - started)
            if rest > 0 and stop.wait(rest):
                break
    finally:
        stop.set()
        dbg('main loop ended; terminating detector')
        if proc.stdin:
            proc.stdin.close()
        proc.terminate()
        try:
            proc.wait(timeout=3)
            dbg(f'detector exited ({proc.returncode})')
        except subprocess.TimeoutExpired:
            dbg('detector did not exit in 3s; killing it (an unflushed clip is lost)')
            proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
