"""Screen check for macOS. Vision OCR text goes to the same Gemini call as the Windows script.

Replaces winocr.recognize_pil. Prompt, model, JSON parse, and 10s interval are unchanged.
Set GEMINI_API_KEY. Grant Screen Recording if OCR comes back empty. Press q to close the banner.
"""

import json
import os
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

CHECK_INTERVAL = 10
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SWIFT = os.path.join(HERE, "macos_vision_ocr.swift")
OCR_BIN = os.path.join(tempfile.gettempdir(), "wyd_macos_vision_ocr")

ui_state = {"is_off_task": False, "reason": "Initializing screen check...", "checking": False}


GEMINI_MODEL = "gemini-3.5-flash-lite"
RATE_LIMIT_COOLDOWN_SEC = 60   # a 429'd key sits out this long
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
        except (gexc.TooManyRequests, gexc.ResourceExhausted):
            _cooldown_until[key] = time.monotonic() + RATE_LIMIT_COOLDOWN_SEC
            limited += 1
            print(f"gemini: key …{key[-4:]} rate-limited, trying the next", file=sys.stderr)
        except (gexc.Unauthorized, gexc.PermissionDenied):
            _cooldown_until[key] = time.monotonic() + BAD_KEY_COOLDOWN_SEC
            print(f"gemini: key …{key[-4:]} rejected, skipping it for {BAD_KEY_COOLDOWN_SEC}s", file=sys.stderr)
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


def call_gemini_api(user_goal, screen_text):
    prompt = f"""
You are an anti-distraction monitor for a hackathon product.
User's Goal: "{user_goal}"
Screen Text Sample:
\"\"\"{screen_text[:1200]}\"\"\"

Rule: Mark "is_off_task": true ONLY if the user is clearly playing games (Steam, Valorant),
watching entertainment streams (Twitch, Netflix), or doomscrolling social media.
Mark false for study, research, articles, terminals, or documentation.

Return strict JSON: {{"is_off_task": false, "reason": "Short summary under 8 words"}}
"""
    response = _generate(prompt)
    data = json.loads(response.text)
    if isinstance(data, list):
        data = data[0]
    return data


def check_once(user_goal):
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
        result = call_gemini_api(user_goal, text)
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
