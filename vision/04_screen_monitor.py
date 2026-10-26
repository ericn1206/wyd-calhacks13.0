"""Screen check for macOS. A local screenshot is OCR'd; Gemini sees the text, not the image.

Set GEMINI_API_KEY. Grant Screen Recording if OCR comes back empty. Press q to close the banner.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback

import cv2
import numpy as np
from PIL import ImageGrab
import google.generativeai as genai

CHECK_INTERVAL = 5
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SWIFT = os.path.join(HERE, "macos_vision_ocr.swift")
OCR_BIN = os.path.join(tempfile.gettempdir(), "wyd_macos_vision_ocr")

ui_state = {"is_off_task": False, "reason": "Initializing screen check...", "checking": False}


GEMINI_MODEL = "gemini-3.5-flash-lite"
RATE_LIMIT_COOLDOWN_SEC = 10   # a 429'd key sits out this long, unless Google names a retry delay
BAD_KEY_COOLDOWN_SEC = 600     # an invalid/forbidden key sits out longer

_keys = []
_next_key = 0
_cooldown_until = {}  # key -> monotonic time it may be used again


def _env_value(name):
    """Environment first, then the repo's .env."""
    value = os.environ.get(name, "").strip()
    if value:
        return value
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        for line in open(env_path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            if key.strip() == name:
                return val.strip().strip('"').strip("'")
    return ""


def gemini_keys():
    """GEMINI_API_KEYS (comma-separated, used round robin), else the single GEMINI_API_KEY."""
    many = [k.strip() for k in _env_value("GEMINI_API_KEYS").split(",") if k.strip()]
    keys = many or [k for k in [_env_value("GEMINI_API_KEY")] if k]
    if not keys:
        raise SystemExit("Set GEMINI_API_KEYS (comma-separated) or GEMINI_API_KEY in the environment or .env.")
    return list(dict.fromkeys(keys))


def gemini_key():
    return gemini_keys()[0]


def setup_gemini():
    """Load the key pool. Each call_gemini_api picks the next key that is not cooling down."""
    global _keys, _next_key
    _keys = gemini_keys()
    _next_key = 0
    print(f"gemini: {len(_keys)} key(s), round robin", file=sys.stderr)


def _generate(prompt):
    """Round robin over the key pool; a rate-limited or rejected key sits out and the next one is tried."""
    global _next_key
    from google.api_core import exceptions as gexc
    if not _keys:
        setup_gemini()
    limited = 0
    for _ in range(len(_keys)):
        key = _keys[_next_key % len(_keys)]
        _next_key += 1
        if _cooldown_until.get(key, 0) > time.monotonic():
            limited += 1
            continue
        genai.configure(api_key=key, transport="rest")
        try:
            return genai.GenerativeModel(GEMINI_MODEL).generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
                request_options={"timeout": 20},
            )
        except (gexc.TooManyRequests, gexc.ResourceExhausted) as e:
            # Google's message names the quota hit (per-minute, tokens, per-day) and may carry a retry delay.
            m = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)|retry in ([\d.]+)s", str(e))
            wait = float(m.group(1) or m.group(2)) if m else RATE_LIMIT_COOLDOWN_SEC
            _cooldown_until[key] = time.monotonic() + wait
            limited += 1
            print(f"gemini: key …{key[-4:]} rate-limited, sitting out {wait:.0f}s: {e}", file=sys.stderr)
        except (gexc.Unauthorized, gexc.PermissionDenied) as e:
            _cooldown_until[key] = time.monotonic() + BAD_KEY_COOLDOWN_SEC
            print(f"gemini: key …{key[-4:]} rejected, skipping it for {BAD_KEY_COOLDOWN_SEC}s: {e}", file=sys.stderr)
    raise RuntimeError(f"TooManyRequests: all {len(_keys)} Gemini key(s) rate-limited or rejected ({limited} limited)")


def ensure_ocr():
    if not os.path.exists(SWIFT):
        raise SystemExit(f"missing {SWIFT}")
    stale = (not os.path.exists(OCR_BIN)) or os.path.getmtime(OCR_BIN) < os.path.getmtime(SWIFT)
    if not stale:
        return OCR_BIN
    print("compiling macOS Vision OCR…")
    proc = subprocess.run(["swiftc", "-O", "-o", OCR_BIN, SWIFT], capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.strip() or "swiftc failed. Install the Xcode command line tools.")
    return OCR_BIN


def capture_screen_text():
    """Screenshot → macOS Vision text. This string is what call_gemini_api sends."""
    screenshot = ImageGrab.grab()
    if screenshot.width > 1600:
        height = int(screenshot.height * 1600 / screenshot.width)
        screenshot = screenshot.resize((1600, height))
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        screenshot.save(path, "PNG")
        proc = subprocess.run([OCR_BIN, path], capture_output=True, text=True)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Vision OCR failed")
    return proc.stdout.strip()


def call_gemini_api(user_goal, screen_text, context=""):
    """`context`: front app and the sites/apps the user said they'd use (a guide, not a whitelist)."""
    context_block = f"\nContext: {context}\n" if context else ""
    prompt = f"""
You are a focus monitor. Decide whether the text on screen is relevant to what the user said they are working on.

User's goal: "{user_goal}"{context_block}
Screen text:
\"\"\"{screen_text[:1200]}\"\"\"

Mark is_off_task true when the screen content is not related to the user's goal or to organizing that work: a clearly different subject, messaging, social media, entertainment, games, shopping, or unrelated browsing.
Mark is_off_task false when the content is about the stated goal or a closely related subtopic that supports it (e.g. goal "algorithms" -> data structures, complexity, pseudocode, a specific algorithm article is fine; ancient history is not).
Planning and organizing the work also counts as on task: calendar, to-do lists, notes, email or course pages about the task.
Apps and sites the user named are expected, but they are not the only allowed ones: judge by what is on screen, not by which app it is in.
If the text is too thin or ambiguous to tell, mark is_off_task false.

Return strict JSON with boolean is_off_task and reason (under 8 words).
"""
    response = _generate(prompt)
    data = json.loads(response.text)
    if isinstance(data, list):
        data = data[0]
    return data


def check_once(user_goal, context=""):
    ui_state["checking"] = True
    ui_state["ocr_chars"] = 0
    try:
        print(f"[{time.strftime('%H:%M:%S')}] Capturing screen...")
        text = capture_screen_text()
        ui_state["ocr_chars"] = len(text)
        print(f" -> OCR got {len(text)} chars")
        if len(text) < 20:
            ui_state["reason"] = "Screen mostly desktop/blank"
            return
        result = call_gemini_api(user_goal, text, context)
        ui_state["is_off_task"] = bool(result.get("is_off_task", False))
        ui_state["reason"] = result.get("reason", "On task")
        print(f" -> {'OFF-TASK' if ui_state['is_off_task'] else 'ON-TASK'}: {ui_state['reason']}")
    except Exception as e:
        traceback.print_exc()
        # RuntimeError carries a readable reason (e.g. every Gemini key rate-limited); keep it for the debug log.
        ui_state["reason"] = f"Error: {e}" if isinstance(e, RuntimeError) else f"Error: {type(e).__name__}"
    finally:
        ui_state["checking"] = False


def worker(user_goal):
    while True:
        check_once(user_goal)
        time.sleep(CHECK_INTERVAL)


def draw_overlay_banner(user_goal):
    w, h = 650, 110
    banner = np.zeros((h, w, 3), dtype=np.uint8)
    off = ui_state["is_off_task"]
    banner[:] = (0, 0, 180) if off else (0, 140, 0)
    cv2.rectangle(banner, (0, 0), (w - 1, h - 1), (255, 255, 255), 2)
    header = "OFF-TASK DETECTED" if off else "ON-TASK & FOCUSED"
    if ui_state["checking"]:
        header += " (Analyzing...)"
    cv2.putText(banner, header, (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 255, 255), 2)
    cv2.putText(banner, f"Goal: {user_goal[:50]}", (15, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)
    cv2.putText(banner, f"Status: {ui_state['reason'][:55]}", (15, 92), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return banner


if __name__ == "__main__":
    setup_gemini()
    ensure_ocr()

    goal = input("What are you working on right now? (e.g. 'circuits'): ").strip() or "circuits"
    print("Screen text is macOS Vision OCR, then Gemini. Grant Screen Recording if the text is empty. Press q to quit.")
    threading.Thread(target=worker, args=(goal,), daemon=True).start()

    cv2.namedWindow("WYD Monitor", cv2.WINDOW_AUTOSIZE)
    try:
        cv2.setWindowProperty("WYD Monitor", cv2.WND_PROP_TOPMOST, 1)
    except cv2.error:
        pass

    while True:
        cv2.imshow("WYD Monitor", draw_overlay_banner(goal))
        if cv2.waitKey(100) & 0xFF == ord("q"):
            break
    cv2.destroyAllWindows()
    sys.exit(0)
