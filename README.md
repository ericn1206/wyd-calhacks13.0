# WYD!! — Local Detection Engine & Integration Specification

This documentation outlines the architecture, setup, and WebSocket integration standards for the **WYD!!** local attention tracking system. It contains two core evaluation engines:
1. **Pose & Gaze Distraction Classifier** (`01_collect_data.py`, `02_train_model.py`, `03_test_model.py`) — Local MediaPipe + XGBoost model.
2. **Screen Context & Relevancy Monitor** (`04_screen_monitor.py`) — Windows Native OCR + Gemini API engine.

---

## 🛠️ Prerequisites & Environment Setup

Ensure the Python environment is set to **Python 3.10+**.

```powershell
# Install core dependencies
pip install opencv-python mediapipe numpy xgboost pandas scikit-learn winocr pillow google-generativeai websockets
