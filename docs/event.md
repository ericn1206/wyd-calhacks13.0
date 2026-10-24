# Shared enums + signal event (SpacetimeDB)

Source of truth: `spacetimedb/src/enums.ts` (plain TS, importable from desktop and worker).
Keep this file in sync with it.

> This is the SpacetimeDB-side event (`ingest_signal`). The older JSON event in `claude.md`
> (`signals` / `activity` / lowercase categories) is still what `worker/types.ts` uses; the two
> haven't been reconciled yet.

## Wire format

Enums are SpacetimeDB sum types. In module code and generated TS bindings a value is
`{ tag: 'Focused' }`. The database stores names case-converted, so raw JSON (CLI `spacetime call`,
SQL output) uses camelCase variants: `{"focused": []}`, `{"phoneInUse": []}`, `{"lockedInPageVisible": []}`.
Field names are snake_case on the wire (`face_present`), camelCase in TS (`facePresent`).

## Enums

| Enum | Values |
|---|---|
| SessionState | Lobby, Active, Break, Ended |
| PomodoroPhase | Work, Break |
| DeviceStatus | Connected, Disconnected |
| AppCategory | Work, Study, Communication, Social, Entertainment, Games, News, Other |
| PhoneState | Unknown, Locked_In_Page_Visible, Phone_In_Use |
| StatusLabel | Focused, OffTask, Away, Break, Unknown |
| ReasonCode | Eyes_Closed, Looking_Away, Phone, Distracting_App, Idle, Left_Seat, Slouching, Unknown |
| ModelName | Haiku, Inferentia, Fallback |
| FocusBlockKind | DeepWork, Interruption, Break |
| ScoreEventKind | Tick, StreakBonus, Penalty, QuickRecovery, GoalChecked |
| CallState | Ringing, Active, Ended, Missed |
| CallEndedReason | Timeout, ManualEnd, AllLeft, Declined |
| CallResponse | Pending, Joined, Declined, Missed |
| AlertKind | NudgeSelf, GroupAlert, PomodoroPhaseChange, GoalCheckin, CallIncoming, TakeoverRequest |
| TakeoverState | Requested, Approved, Denied, Executed, Expired |
| TakeoverAction | CloseTab, ShowOverlay, MuteApp |
| PhoneSensorState | Unpaired, Paired, Visible, Hidden |
| PhonePlatform | iOS, Android, Other |
| AwardKind | MVP, Derailer, BestRecovery, LongestStreak |
| StuckState | Open, Resolved |
| StuckRole | User, Assistant |
| MatchType | App, Domain, TitleRegex |

## The 10-second event: `ingest_signal(event: SignalInput)`

Sent by the desktop client every `event_interval_secs` (10). The server adds `id`, `session_id`,
`member_id`, `ts` (server time).

| Field | Type | Filled by | Notes |
|---|---|---|---|
| seq | u64 | desktop | Per-member client sequence; a repeated seq is rejected |
| face_present | bool | vision | |
| eyes_closed | bool | vision | |
| looking_away | bool | vision | |
| head_yaw, head_pitch | f32 | vision | degrees |
| posture_slouch_score | f32 | vision | 0 to 1 |
| phone_in_hand | bool | vision | |
| facial_expression | option string | vision | DeepFace label |
| expression_confidence | f32 | vision | |
| active_app | string | desktop | |
| active_window_title | option string | desktop | |
| active_url_domain | option string | desktop | lowercased server-side |
| app_category | AppCategory | desktop | send `Other` to let server rules classify |
| phone_state | PhoneState | desktop | overridden by the paired phone page when its heartbeat is fresh |
| webcam_confidence | f32 | vision | 0 means "no webcam reading" |
| idle_secs | u32 | desktop | |
| client_version | string | desktop | |

Server-side consent enforcement: without `consent_webcam` all vision fields are zeroed;
without `consent_activity` app becomes `"hidden"`, title/domain are dropped, category is `Other`;
without `consent_phone` phone_state is `Unknown`.

## Judgment: `write_judgment(...)` (AI worker only)

`event_id, label: StatusLabel, reason: ReasonCode, confidence: f32, model: ModelName,
latency_ms, input_tokens, output_tokens, cost_usd`. One judgment per event; a worker result
replaces a server fallback judgment for the same event.

Judgment input should stay text-only (signals + activity), per the privacy rules.
