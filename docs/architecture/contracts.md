# Contracts

Shared shapes between components. Don't change without telling the team. Two event formats exist and aren't reconciled yet (`../product/decisions.md`).

## Event (team contract JSON)
Used by `worker/types.ts` (`FocusEvent`) and `src/main/categorize.ts` (`activity`).
```json
{
  "user": "jake",
  "session": "abc123",
  "time": "2026-10-24T01:12:00Z",
  "signals": { "eyes": "open", "posture": "upright", "lookingAway": false, "phoneVisible": false, "phoneInUse": false },
  "activity": { "app": "Chrome", "title": "YouTube", "category": "video" },
  "status": "off_task",
  "confidence": 0.86,
  "reason": "Watching YouTube for 3 minutes"
}
```
- Writers: vision → `signals`; desktop → `activity`; worker → `status`, `confidence`, `reason`.
- `signals.eyes`: `open`|`closed` · `signals.posture`: `upright`|`slouched`
- `status`: `on_task` | `off_task` | `break` (optional `stuck`)
- `category`: `coding` `notes` `docs` `school` `chat` `social` `video` `music` `unknown`
- `reason`: ≤ 8 words, friendly (may be shown to the group).

## SpacetimeDB enums
Source of truth: `spacetimedb/src/enums.ts`.

Wire format: in module code / TS bindings a value is `{ tag: 'Focused' }`. Raw JSON (CLI, SQL) uses camelCase variants: `{"focused": []}`, `{"phoneInUse": []}`. Fields are snake_case on the wire (`face_present`), camelCase in TS (`facePresent`).

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

## SignalInput
`ingest_signal(event: SignalInput)`, sent by desktop every `event_interval_secs` (10). Server adds `id`, `session_id`, `member_id`, `ts`.

| Field | Type | By | Notes |
|---|---|---|---|
| seq | u64 | desktop | per-member; repeat rejected |
| face_present, eyes_closed, looking_away | bool | vision | |
| head_yaw, head_pitch | f32 | vision | degrees |
| posture_slouch_score | f32 | vision | 0–1 |
| phone_in_hand | bool | vision | |
| facial_expression | option string | vision | DeepFace label |
| expression_confidence | f32 | vision | |
| active_app | string | desktop | |
| active_window_title | option string | desktop | |
| active_url_domain | option string | desktop | lowercased server-side |
| app_category | AppCategory | desktop | `Other` → server rules classify |
| phone_state | PhoneState | desktop | overridden by fresh phone heartbeat |
| webcam_confidence | f32 | vision | 0 = no reading |
| idle_secs | u32 | desktop | |
| client_version | string | desktop | |

No consent gating: all fields are stored as sent (consent flags and `set_consent` removed).

## write_judgment (worker only)
`event_id, label: StatusLabel, reason: ReasonCode, confidence: f32, model: ModelName, latency_ms, input_tokens, output_tokens, cost_usd`. One per event; replaces a fallback judgment for the same event.

Other reducers: `../components/spacetimedb-schema.md#reducers`.

## Desktop IPC (`src/preload/index.ts`)
`window.wydDesktop` (typings: `src/renderer/src/electron.d.ts`):
| Method | Channel | Direction | Payload |
|---|---|---|---|
| `getPreferences` / `setPreferences` | `wyd:preferences:get` / `:set` | renderer → main (invoke) | `{checkInCorner}` in userData `preferences.json` |
| `requestMediaPermissions` | `wyd:media:request` | invoke | `{camera, microphone}` |
| `setAlwaysOnTop` / `setIgnoreMouseEvents` / `moveToCorner` / `getDisplays` | `wyd:window:*`, `wyd:displays:get` | invoke | window/display control |
| `startTracking` | `wyd:tracking:start` | invoke | `{subject, goals[]}` → `monitor.setSessionContext` + `start()`; called on Goals submit |
| `onActivityUpdate` | `activity:update` | main → renderer | `ActivityState` (every 2 s); no UI consumer yet |
| `onActivityAlert` | `activity:alert` | main → renderer | `ActivityState` when `alertLevel` is `warning`/`alert`; no UI consumer yet |

`window.circleAPI` (LiveKit, unwired; typings `src/renderer/src/circle.d.ts`): `requestMediaAccess`, `getCallToken` (`call:token`), `setCallMode` (`window:call-mode`).

Removed: `activityAPI`, `sessionAPI` (voice onboarding, archived in `outdated/`). Type: `ActivityState` in `src/main/activityMonitor.ts`.

## Worker functions
- `judge(topic, events: FocusEvent[], phase='work'|'break') → {status, confidence, reason}` (`worker/judge.ts`)
- `categorizeUnknown(app, title) → ActivityCategory` (`worker/categorizeUnknown.ts`)
