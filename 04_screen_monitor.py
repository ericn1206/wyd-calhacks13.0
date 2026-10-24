import os
import asyncio, time, json, threading, traceback
import cv2
import numpy as np
import winocr
from PIL import ImageGrab
import google.generativeai as genai


GEMINI_API_KEY = "AQ.Ab8RN6JqEwAVZnkrxhc2yoY5wg3zO9tLSXXvDTmD3QvdL2NrYw"   # better: os.environ["GEMINI_API_KEY"]
CHECK_INTERVAL = 10

genai.configure(api_key=GEMINI_API_KEY,transport="rest")
model = genai.GenerativeModel("gemini-3.5-flash-lite")

ui_state = {"is_off_task": False, "reason": "Initializing screen check...", "checking": False}

async def _ocr(img):
    return await winocr.recognize_pil(img, lang="en")

def capture_screen_text():
    screenshot = ImageGrab.grab()
    result = asyncio.run(_ocr(screenshot))
    text = result.text if hasattr(result, "text") else str(result)
    return text.strip()

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
    goal = input("What are you working on right now? (e.g. 'circuits'): ").strip() or "circuits"
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