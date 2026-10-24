import cv2
import mediapipe as mp
import numpy as np
import xgboost as xgb
import pandas as pd

model = xgb.XGBClassifier()
model.load_model('distraction_model.json')

mp_face_mesh = mp.solutions.face_mesh
mp_pose = mp.solutions.pose
face_mesh = mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
pose = mp_pose.Pose()

cap = cv2.VideoCapture(0)
distraction_history = []

print("=== ACCURATE LIVE MODEL TEST ===")

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    face_results = face_mesh.process(rgb_frame)
    pose_results = pose.process(rgb_frame)

    if face_results.multi_face_landmarks:
        face_landmarks = face_results.multi_face_landmarks[0].landmark
        
        nose = np.array([face_landmarks[1].x * w, face_landmarks[1].y * h])
        chin = np.array([face_landmarks[152].x * w, face_landmarks[152].y * h])
        left_eye = np.array([face_landmarks[33].x * w, face_landmarks[33].y * h])
        right_eye = np.array([face_landmarks[263].x * w, face_landmarks[263].y * h])
        face_center = (left_eye + right_eye) / 2

        pitch = chin[1] - nose[1]
        yaw = right_eye[0] - left_eye[0]
        roll = np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
        nose_x_offset = nose[0] - face_center[0]
        nose_y_offset = nose[1] - face_center[1]
        left_eye_ratio = abs(face_landmarks[159].y - face_landmarks[145].y)
        right_eye_ratio = abs(face_landmarks[386].y - face_landmarks[374].y)

        shoulder_dist = 0
        if pose_results.pose_landmarks:
            pose_landmarks = pose_results.pose_landmarks.landmark
            l_shoulder = np.array([pose_landmarks[11].x * w, pose_landmarks[11].y * h])
            r_shoulder = np.array([pose_landmarks[12].x * w, pose_landmarks[12].y * h])
            shoulder_center = (l_shoulder + r_shoulder) / 2
            shoulder_dist = np.linalg.norm(nose - shoulder_center)

        features = pd.DataFrame([[
            pitch, yaw, roll, 
            nose_x_offset, nose_y_offset, 
            left_eye_ratio, right_eye_ratio, 
            shoulder_dist
        ]], columns=[
            "pitch", "yaw", "roll", 
            "nose_x_offset", "nose_y_offset", 
            "left_eye_ratio", "right_eye_ratio", 
            "shoulder_dist"
        ])
        
        prob = model.predict_proba(features)[0][1]
        distraction_history.append(prob)
        if len(distraction_history) > 20:
            distraction_history.pop(0)

        avg_score = float(np.mean(distraction_history))
        is_distracted = avg_score > 0.65

        status_text = f"DISTRACTED ({int(avg_score * 100)}%)" if is_distracted else f"FOCUSED ({int((1 - avg_score) * 100)}%)"
        banner_color = (0, 0, 255) if is_distracted else (0, 255, 0)

        cv2.rectangle(frame, (0, 0), (w, 60), (0, 0, 0), -1)
        cv2.putText(frame, status_text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, banner_color, 3)

    cv2.imshow("Accurate Model Test", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()