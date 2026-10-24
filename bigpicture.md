One-liner: An opt-in group focus tool that gently pulls teammates back together when someone drifts — using computer vision, light phone signals, and a surprise FaceTime-style check-in.
Core Concept
Small groups (study sessions, remote teammates, co-working pods) start a shared Focus Session. Everyone opts in.
While the session is active, the system quietly watches for sustained off-task behavior using:
Webcam (presence + rough attention signals)
Optional phone unlock / app activity
Browser / window context (non-real-time is fine)
When someone has been off-task for a meaningful period, the system triggers a surprise group FaceTime-style video call. The whole circle pops up on screen. No public roast, no points, no leaderboard — just an immediate, human moment that re-connects the group and makes drifting feel social rather than shameful. *make sure calls dont happen too much and the calls dont last too long. 
At the end of the session, everyone gets a clean, private summary of deep-work blocks and interruptions (no scores).
Sensors
Webcam: eyes (sleeping), posture, head direction, phone in hand. Off-the-shelf MediaPipe, no training needed.
attention/facial expression tracking library: https://github.com/serengil/deepface 
Posture tracking
Computer: active app or tab, sorted into categories.
Phone: a Lock In web page left open; leaving it means “phone in use.”
Features
Group sessions with a live scoreboard (scoreboard is tentative?)
Personalized spoken roasts (not sure)
Opt-in alerts to the group
Pomodoro timers
Session summary with a Mario Kart–style replay of your worst moments (opt-in, stays local)
When someone is locked out someone else can take over screen and close the tab
Scoring fix (your “arbitrary” concern): Each person sets 2–3 goals at the start and checks them off at each break. Score = focus × goals completed, so looking busy doesn’t win.
Stack
Electron desktop app with MediaPipe running locally
SpacetimeDB for real-time group sync
Inferentia small model for off-task judgment
Claude for roasts and summaries
Cartesia for voice
Factory for alerts
Notability for summary export
Elastic (optional) for “when do I focus best?” search
Privacy: Processing stays on each laptop. Only small events are shared, no video leaves the machine, and everyone opts in.
Build order
Webcam and activity tracking
Group sync and scoreboard
Judgment and scoring
Roasts and alerts
Phone sensor
Extras
Steps 1–4 are a complete demo.
Pitch line: “Lock In makes focus social. Your friends keep you honest, and the AI keeps score.”
