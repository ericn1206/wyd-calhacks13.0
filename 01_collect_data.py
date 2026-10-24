import cv2
import mediapipe as mp
import numpy as np
import csv
import time

mp_face_mesh = mp.solutions.face_mesh
mp_pose = mp.solutions.pose

face_mesh = mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
pose = mp_pose.Pose()

cap = cv2.VideoCapture(0)

print("=== ENHANCED DATA COLLECTOR ===")
label = input("Enter label to record (0 = Focused, 1 = Distracted): ")

duration = int(input("Enter recording duration in seconds (Recommended: 90 to 120): "))

csv_file = open('distraction_dataset.csv', 'a', newline='')
writer = csv.writer(csv_file)

if csv_file.tell() == 0:
    writer.writerow([
        "pitch", "yaw", "roll", 
        "nose_x_offset", "nose_y_offset",
        "left_eye_ratio", "right_eye_ratio", 
        "shoulder_dist", "label"
    ])

print(f"\nStarting recording for label {label} in 3 seconds... Get ready!")
time.sleep(3)

start_time = time.time()
samples_count = 0

while cap.isOpened():
    elapsed = time.time() - start_time
    if elapsed >= duration:
        break

    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    face_results = face_mesh.process(rgb_frame)
    pose_results = pose.process(rgb_frame)

    if face_results.multi_face_landmarks:
        face_landmarks = face_results.multi_face_landmarks[0].landmark
        
        # Key landmark points
        nose = np.array([face_landmarks[1].x * w, face_landmarks[1].y * h])
        chin = np.array([face_landmarks[152].x * w, face_landmarks[152].y * h])
        left_eye = np.array([face_landmarks[33].x * w, face_landmarks[33].y * h])
        right_eye = np.array([face_landmarks[263].x * w, face_landmarks[263].y * h])
        face_center = (left_eye + right_eye) / 2

        # 1. Angles
        pitch = chin[1] - nose[1]
        yaw = right_eye[0] - left_eye[0]
        roll = np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])

        # 2. Nose offset relative to eye center (Head Turn Indicator)
        nose_x_offset = nose[0] - face_center[0]
        nose_y_offset = nose[1] - face_center[1]

        # 3. Eye Aspect Ratios
        left_eye_ratio = abs(face_landmarks[159].y - face_landmarks[145].y)
        right_eye_ratio = abs(face_landmarks[386].y - face_landmarks[374].y)

        # 4. Shoulder Distance (Posture)
        shoulder_dist = 0
        if pose_results.pose_landmarks:
            pose_landmarks = pose_results.pose_landmarks.landmark
            l_shoulder = np.array([pose_landmarks[11].x * w, pose_landmarks[11].y * h])
            r_shoulder = np.array([pose_landmarks[12].x * w, pose_landmarks[12].y * h])
            shoulder_center = (l_shoulder + r_shoulder) / 2
            shoulder_dist = np.linalg.norm(nose - shoulder_center)

        writer.writerow([
            pitch, yaw, roll, 
            nose_x_offset, nose_y_offset, 
            left_eye_ratio, right_eye_ratio, 
            shoulder_dist, label
        ])
        samples_count += 1

    remaining = int(duration - elapsed)
    cv2.putText(frame, f"Rec Label {label} | Time Left: {remaining}s | Samples: {samples_count}", 
                (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    cv2.imshow("Data Collector", frame)
    
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
csv_file.close()
print(f"Recorded {samples_count} samples for label {label}.")