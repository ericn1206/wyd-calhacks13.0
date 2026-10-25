# SpacetimeDB schema

Overview, visibility, behavior: `spacetimedb.md`. Enums: `../architecture/contracts.md#spacetimedb-enums`.

## Tables

Field names are camelCase in TS and snake_case in the database. `?` = optional. `idx` = btree index.

### 1. user — public
identity (PK) · display_name · avatar_color · created_at · online

Auto-created on connect as `guest-xxxx`; set with `set_profile`.

### 2. session — own session
id (PK, auto_inc) · code (unique, 6 chars) · name · state: SessionState ·
started_at? · ended_at? · pomodoro_work_secs (1500) · pomodoro_break_secs (300) ·
current_phase: PomodoroPhase · phase_started_at? · cycle_number · off_task_threshold_secs (0) ·
call_cooldown_secs (600) · max_call_secs (90) · scoreboard_enabled (false) · group_call_enabled (true)

### 3. member — own session
id (PK, auto_inc) · session_id (idx) · identity (idx) · left_at? ·
device_status: DeviceStatus · phone_linked · is_host · goals_set
Extra index: (session_id, identity).
`is_host` is the only host record. Host leaves → active member with the lowest `id` becomes host. `join_session` always inserts a fresh row (rejoiners go to the back of the line, goals reset).

### 4. goal — own session
id (PK, auto_inc) · session_id (idx) · member_id (idx) · text · position (1–3) · completed ·
completed_at? · checked_at_break_number?

### 5. signal_event — private
id (PK, auto_inc) · session_id (idx) · member_id (idx) · ts (idx) · seq · face_present · eyes_closed ·
looking_away · head_yaw · head_pitch · posture_slouch_score · phone_in_hand · facial_expression? ·
expression_confidence · active_app · active_window_title? · active_url_domain? ·
app_category: AppCategory · phone_state: PhoneState · webcam_confidence · idle_secs · client_version
Extra index: (member_id, seq) for duplicate rejection.

### 6. status — own session (one row per member)
member_id (PK) · session_id (idx) · label: StatusLabel · reason_code: ReasonCode · confidence ·
since · last_event_id · smoothed_off_task_secs · updated_at

### 7. judgment — private
id (PK, auto_inc) · event_id (idx) · member_id (idx) · session_id (idx) · raw_label: StatusLabel ·
raw_confidence · reason_code · model_name: ModelName · latency_ms · input_tokens · output_tokens ·
cost_usd · created_at

### 8. focus_block — own session
id (PK, auto_inc) · session_id (idx) · member_id (idx) · kind: FocusBlockKind · reason_code? ·
started_at · ended_at? · duration_secs · pomodoro_cycle

### 9. score — own session, gated by scoreboard_enabled
member_id (PK) · session_id (idx) · focus_points · focus_ratio · goals_completed · goals_total ·
final_score (= focus_ratio × goals_completed) · current_streak_secs · best_streak_secs ·
penalties_total · recovery_bonus_total · interruptions_count · updated_at

### 10. score_event — private
id (PK, auto_inc) · member_id (idx) · session_id (idx) · ts · kind: ScoreEventKind · delta · note

### 13. group_call — own session
id (PK, auto_inc) · session_id (idx) · triggered_by_member_id (idx) · trigger_reason_code · room_id ·
room_url? · state: CallState · created_at · started_at? · ended_at? · max_duration_secs ·
ended_reason?: CallEndedReason

### 14. call_participant — own session
id (PK, auto_inc) · call_id (idx) · member_id (idx) · joined_at? · left_at? · response: CallResponse

### 15. call_cooldown — private
session_id (PK) · last_call_at · calls_in_last_hour

### 15b. call_member_trigger — private
member_id (PK) · session_id (idx) · last_triggered_at (last call *or* nudge for this member)

### 16. alert — targeted member
id (PK, auto_inc) · session_id (idx) · target_member_id (idx) · kind: AlertKind · payload_json ·
created_at · delivered · delivered_at? · factory_run_id?

### 17. takeover_request — own session
id (PK, auto_inc) · session_id (idx) · requester_member_id (idx) · target_member_id (idx) ·
state: TakeoverState · action: TakeoverAction · created_at · resolved_at? · requires_target_consent (true)

### 18. phone_sensor — owner + paired phone
member_id (PK) · session_id (idx) · pairing_code (unique) · phone_identity? · page_visible ·
last_heartbeat_at? · state: PhoneSensorState · platform: PhonePlatform

### 19. replay_clip_meta — owner only
id (PK, auto_inc) · member_id (idx) · session_id (idx) · ts · duration_secs · reason_code ·
local_path_hash · deleted_after_session

### 19b. session_clip — own session (finished clips of anyone + own uploads in progress, via `my_session_clips`)
id (PK, auto_inc) · clip_key (unique, client uuid) · session_id (idx) · member_id (idx, who was unfocused) · identity ·
moment_at_ms (u64, off-task moment) · started_at_ms (u64, first frame ≈ moment − 10 s) · duration_ms · width · height · fps ·
mime (`video/mp4`) · size_bytes · chunk_count · received_chunks · complete · created_at

### 19c. session_clip_chunk — private, no client view
id (PK, auto_inc) · clip_id (idx) · seq · data: byte array. File = chunks ordered by `seq`. Chunk ≤ 256 KiB.

### 19d. session_compilation — own session (`my_session_compilations`), written by the clip worker only
session_id (PK) · status: CompilationStatus · clip_count (clips in the video at `url`; 0 until Ready) · url? · error? · updated_at. Flow: `clip-compiler.md`.

### 20. session_summary — owner only
id (PK, auto_inc) · session_id (idx) · member_id (idx) · total_secs · deep_work_secs ·
longest_block_secs · interruption_count · top_distraction_category? · goals_completed · goals_total ·
summary_text (written by the worker; empty until then) · notability_pdf_ref? · created_at

### 21. session_award — own session
id (PK, auto_inc) · session_id (idx) · member_id (idx) · kind: AwardKind · value · note

### 22. stuck_session — owner only
id (PK, auto_inc) · session_id (idx) · member_id (idx) · started_at · ended_at? · topic · state: StuckState

### 23. stuck_message — owner only
id (PK, auto_inc) · stuck_id (idx) · role: StuckRole · text · ts

### 24. app_category_rule — public
id (PK, auto_inc) · session_id? (none = global) · pattern · match_type: MatchType ·
category: AppCategory (`OnTask`/`OffTask`) · on_task_default
No longer consulted by `ingest_signal` (classification is client-side); seeded rows remain. Candidate to drop.
`session_id` is not indexed (SpacetimeDB can't index option columns; the table is tiny).

### 25. session_context — own session
session_id (PK) · topic_description · allowed_domains · blocked_domains

### 26. worker_heartbeat — private
worker_id (PK) · last_seen_at · model_in_use · queue_depth

### 27. app_setting — public
key (PK) · value_json

Seeded: `smoothing_hold_secs=60`, `low_confidence_threshold=0.5`, `event_interval_secs=10`,
`call_cooldown_secs=600`, `call_max_secs=90`,
`quick_recovery_window_secs=30`. Extra keys: `streak_bonus_every_secs=300`, `worker_stale_secs=30`,
`fallback_judge_after_secs=20`, `phone_heartbeat_stale_secs=30`, `takeover_expire_secs=120`,
`call_room_base_url=""`.

### 28. focus_history_index — private
id (PK, auto_inc) · member_id (idx) · session_id (idx) · hour_of_day (UTC) · day_of_week (UTC) ·
focus_ratio · indexed_at

### Internal
- `authorized_worker`: identity (PK) · added_at. Seeded with the publisher's identity.
- `active_connection`: identity (PK) · connection_id. Newest connection wins; a superseded socket's disconnect is ignored (no Disconnected flip, no reaper).
- `pomodoro_timer`: one-shot → `advance_pomodoro`
- `score_tick_timer`: every 10 s per tracked member → `tick_score`
- `call_timeout_timer`: one-shot → `call_timeout`
- `disconnect_timer`: one-shot 60 s after a member's client disconnects → `leave_if_still_disconnected` (leaves if still `Disconnected`; cleared on reconnect or leave)

## Reducers

| Reducer | Caller | Notes |
|---|---|---|
| set_profile(display_name, avatar_color) | anyone | |
| create_session(name, settings) | anyone | Caller becomes host; leaves any other active session |
| join_session(code) | anyone | Case-insensitive code; one active session per identity |
| leave_session() | member | Host passes to the earliest remaining member; last one out ends the session |
| set_goals(goals[]) | member | 1–3 goals, replaces existing |
| check_goal(goal_id, done) | goal owner | Logs GoalChecked, recomputes final_score |
| update_session_context(topic, allowed, blocked) | host | |
| set_pomodoro(work_secs, break_secs) | host | any state but Ended; while Active/Break it first stops the timer (→ Lobby); work 60–7200 s, break 60–3600 s |
| stop_pomodoro() | host | Active/Break → Lobby: cancels pomodoro + tick timers, closes focus blocks, cycle 0; Start again with `start_session` |
| take_break() | host | Active (work round) only: flips to Break now; break timer then runs as normal. No pause/skip |
| leave_if_still_disconnected | scheduler only | Disconnect grace (60 s) expired → `leave_session` semantics (host passes on, empty session ends) |
| start_session() | host | Lobby → Active, cycle 1, schedules pomodoro + per-member ticks |
| advance_pomodoro | scheduler only | Work ↔ Break; PomodoroPhaseChange + GoalCheckin alerts |
| end_session() | host | Ends calls, expires takeovers, finalizes, deletes replay metadata |
| finalize_session(session_id) | host / worker | Idempotent retry of finalization |
| delete_replay_meta_on_end(session_id) | host / worker | Ended sessions only |
| ingest_signal(event) | member | Validates member/session, rejects duplicate seq, rule-classifies `Other`, fallback-judges when the worker is offline |
| write_judgment(...) | worker only | |
| apply_smoothing(member_id) | worker only | Also runs every tick and on every `ingest_signal`/`write_judgment` |
| tick_score | scheduler only | Fallback-judges stale events, smoothing, scoring, call/nudge trigger |
| maybe_trigger_group_call(member_id) | worker only | Also runs every tick |
| set_call_room_url(call_id, url) | worker only | For a Daily/LiveKit room the worker created |
| respond_to_call(call_id, Joined/Declined) | participant | First join: Ringing → Active; all declined → Ended(Declined) |
| (call trigger) | server | A new call ends any Ringing/Active call first (`Superseded`; unanswered → Missed). Cooldown still applies |
| end_call(call_id) | participant | Host ends for all; otherwise leaves, ends when everyone has left |
| call_timeout | scheduler only | Ended(Timeout), or Missed if nobody joined |
| mark_alert_delivered(alert_id) | alert target | |
| request_takeover(target_id, action) | member | Always requires target consent |
| respond_takeover(request_id, approve) | target | Expires after 120 s |
| complete_takeover(request_id) | target | Approved → Executed |
| start_phone_pairing() | member | Code appears in `my_phone_sensor` |
| pair_phone(code, platform) | phone page | Links the phone's identity |
| phone_heartbeat(visible) | paired phone | |
| add_replay_clip(duration, reason, path_hash) | member | Metadata only (unused; superseded by `session_clip`) |
| begin_session_clip(clip_key, moment_at_ms, started_at_ms, duration_ms, width, height, fps, mime, size_bytes, chunk_count) | member | Caller's newest member row; allowed up to 600 s after the session ended / member left. Same key again restarts the upload. Limits: 12 MiB, 64 chunks, 60 s, 20 clips per member |
| upload_clip_chunk(clip_key, seq, data) | clip owner | ≤ 256 KiB; same `seq` again replaces |
| finish_session_clip(clip_key) | clip owner | Needs every chunk and exact `size_bytes`; sets `complete` |
| set_session_compilation(session_id, status, clip_count, url?, error?) | worker only | Upsert; `Ready` needs `url` |
| set_clip_page_base_url(url) | worker only | Upserts `app_setting` `clip_page_base_url` (JSON string, no trailing `/`); http(s), ≤ 200 chars |
| start_stuck(topic) / post_stuck_message(stuck_id, text) / resolve_stuck(stuck_id) | owner (worker posts as Assistant) | |
| authorize_worker(identity) | worker | Add another worker identity |
| report_worker_heartbeat(worker_id, model, queue_depth) | worker | |
| set_summary_text(summary_id, text) | worker | Claude recap |
| seed_defaults() | worker (or anyone, if no worker exists yet) | Idempotent; re-run after a migration publish |
