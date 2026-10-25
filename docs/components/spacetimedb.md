# SpacetimeDB module

Purpose: real-time session state + all group rules (smoothing, cooldowns, call/nudge, Pomodoro, finalize). Tables/reducers: `spacetimedb-schema.md`. Shared enums + `SignalInput`: `../architecture/contracts.md`. SDK rules (deterministic reducers, `ctx.sender`, etc.): `../reference/spacetimedb-sdk.md`.

## Files
Module: `spacetimedb/` (`spacetime.json` → `module-path: ./spacetimedb`, database `calhacks-13-wyd`).

- `src/enums.ts`: shared enum lists (see `../architecture/contracts.md`)
- `src/schema.ts`: tables
- `src/logic.ts`: smoothing, scoring, call/nudge triggers, finalize
- `src/index.ts`: reducers, lifecycle hooks, views

## Visibility model

Only `user`, `app_category_rule`, `app_setting` are public tables.
**Every other table is private.** Clients read session data through per-sender **views**, which
return rows only for sessions the caller has a `member` row in. Owner-only data has owner-only
views. Live data is visible only while `member.left_at` is unset; ended sessions stay readable (summary, awards, scores) to everyone who was in them. Raw signals, judgments, score events, limiters, cooldowns, and worker heartbeats have no
client view at all (the worker reads unjudged events through a worker-only view).

Subscribe like: `SELECT * FROM my_session_statuses`.

| Visibility | Tables | How clients read |
|---|---|---|
| Public | user, app_category_rule, app_setting | table directly |
| Own session | session, member, goal, status, focus_block, group_call, call_participant, takeover_request, session_award, session_context | `my_sessions`, `my_session_*` views |
| Own session, gated | score | `my_session_scores`: own row always; others only if `scoreboard_enabled` |
| Targeted member | alert | `my_alerts` |
| Owner only | session_summary, stuck_session, stuck_message, phone_sensor, replay_clip_meta | `my_session_summaries`, `my_stuck_*`, `my_phone_sensor` (also the paired phone), `my_replay_clips` |
| Private (no client view) | signal_event, judgment, score_event, call_cooldown, call_member_trigger, worker_heartbeat, focus_history_index, authorized_worker, timer tables | reducers only; worker views below |

Worker-only views (empty for non-workers): `worker_pending_signal_events`, `worker_recent_judgments`,
`worker_pending_summaries`, `worker_summary_goals`,
`worker_session_contexts`, `worker_open_stuck_sessions`, `worker_open_stuck_messages`.

No table stores video, images, or audio. `replay_clip_meta` holds a hash of the local path, and the clip stays on the laptop.

## Behavior

**Smoothing (every 10 s per member).** Judgments with confidence < `low_confidence_threshold` or
label Unknown are neutral and skipped. The status label changes only once the newest confident label
has held for `smoothing_hold_secs` with no contradicting confident label. `since` is backdated to when
that streak began, so `smoothed_off_task_secs` counts from the first off-task event. During Break
the label is Break. No events for a full hold window → Away (Left_Seat). Each change closes the open
focus_block and opens a new one (Focused → DeepWork, OffTask/Away → Interruption, Break → Break).

**Fallback judging.** If no worker heartbeat in the last `worker_stale_secs`, `ingest_signal` judges
immediately with simple rules (model `Fallback`). The tick also judges any event the worker hasn't
labelled after `fallback_judge_after_secs`. The demo works with no worker running.

**Scoring (Work phase only).** Focused: +1 per tick (Tick), +5 each 5-minute streak (StreakBonus).
OffTask: −2 per tick (Penalty). Returning to Focused within `quick_recovery_window_secs` of a
nudge or call in that episode: +3 (QuickRecovery). `focus_ratio` = DeepWork secs / (DeepWork +
Interruption secs). `final_score = focus_ratio × goals_completed`.

**Group call.** Same off-task condition, `group_call_enabled`, once per episode, no call already
ringing/active. Inside `call_cooldown_secs` of the last call, or with fewer than 2 active members,
the member gets a NudgeSelf alert instead. Otherwise: group_call (Ringing), a call_participant +
CallIncoming alert per active member, and an auto-end after `min(max_call_secs, call_max_secs)`.
`room_id` is `wyd-<code>-<n>`; `room_url` is `call_room_base_url + room_id` if that setting is set,
or whatever the worker writes with `set_call_room_url`.

**Finalize.** Closes open blocks; per member writes session_summary (text left empty for the worker)
and focus_history_index; awards MVP (highest final_score), Derailer (most interruptions),
BestRecovery, LongestStreak, each only when its value is > 0.

## Worker setup

The identity that first publishes the database is an authorized worker. To use a separate worker
identity, call `authorize_worker` from the publisher with the worker's identity.

`init` (and its seeds) only runs on the first publish or with `--delete-data`. When publishing this
schema over the existing database, run `spacetime call calhacks-13-wyd seed_defaults` once afterwards;
if no worker exists yet, the caller becomes the first authorized worker.
