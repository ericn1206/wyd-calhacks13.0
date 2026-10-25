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
model = None


def gemini_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        for line in open(env_path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "GEMINI_API_KEY":
                value = value.strip().strip('"').strip("'")
                if value:
                    return value
    raise SystemExit("Set GEMINI_API_KEY in the environment or in .env.")


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
    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
        request_options={"timeout": 20},
    )
    data = json.loads(response.text)
    if isinstance(data, list):
        data = data[0]
    return data


def check_once(user_goal):
    ui_state["checking"] = True
    try:
        print(f"[{time.strftime('%H:%M:%S')}] Capturing screen...")
        text = capture_screen_text()
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
        ui_state["reason"] = f"Error: {type(e).__name__}"
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
    genai.configure(api_key=gemini_key(), transport="rest")
    model = genai.GenerativeModel("gemini-3.5-flash-lite")
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
