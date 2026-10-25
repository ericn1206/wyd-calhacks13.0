"""Start the webcam detector and the screen monitor, then print face time.

An interval is 10 seconds. Print face time when either streak hits 2:
1. Screen monitor off-task two intervals in a row (webcam is ignored).
2. Screen monitor on-task both intervals, and the webcam distracted both times.
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
INTERVAL_SEC = 10
STREAK_TO_FIRE = 2

stop = threading.Event()
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
        with lock:
            saw_webcam = True
            webcam_distracted = bool(msg.get("distracted"))
            webcam_last = msg
        if stop.is_set():
            break


def screen_vote(screen, goal, sites):
    """'off' is a screen hit. 'ok' is on-task. 'unknown' is blank or an error.

    Gemini decides from the OCR text. The front app and the sites/apps the user mentioned are
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
    signal.signal(signal.SIGTERM, lambda *_: stop.set())

    detector = os.path.join(HERE, "detector.py")
    model = os.path.join(HERE, "distraction_model.json")
    proc = subprocess.Popen(
        [sys.executable, detector, "--model", model],
        cwd=os.path.dirname(HERE),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,
    )
    threading.Thread(target=read_webcam, args=(proc,), daemon=True).start()

    screen = None
    try:
        screen = load_screen()
        screen.setup_gemini()  # GEMINI_API_KEYS round robin (or the single GEMINI_API_KEY)
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
        if proc.stdin:
            proc.stdin.close()
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
