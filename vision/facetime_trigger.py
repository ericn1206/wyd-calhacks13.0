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


def load_screen():
    path = os.path.join(HERE, "04_screen_monitor.py")
    spec = importlib.util.spec_from_file_location("screen_monitor", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_webcam(proc):
    global webcam_distracted, saw_webcam
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
        if stop.is_set():
            break


def screen_vote(screen, goal):
    """'off' is a screen hit. 'ok' is on-task. 'unknown' is blank or an error."""
    screen.check_once(goal)
    reason = str(screen.ui_state.get("reason", ""))
    if reason == "Screen mostly desktop/blank" or reason.startswith("Error:"):
        return "unknown"
    return "off" if screen.ui_state.get("is_off_task") else "ok"


def main():
    goal = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].strip() else "study"
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
        import google.generativeai as genai
        genai.configure(api_key=screen.gemini_key(), transport="rest")
        screen.model = genai.GenerativeModel("gemini-3.5-flash-lite")
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
            if screen is not None:
                try:
                    vote = screen_vote(screen, goal)
                except Exception as err:
                    print(f"screen check failed: {type(err).__name__}: {err}", file=sys.stderr)
                    vote = "unknown"
            with lock:
                cam_off = saw_webcam and webcam_distracted
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
            if vote == "off" or (vote == "ok" and cam_off):
                print("status off", flush=True)
            elif vote == "ok":
                print("status on", flush=True)
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
