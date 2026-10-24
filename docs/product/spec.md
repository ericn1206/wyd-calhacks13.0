# Spec

## User flow
Open app → join session → intro popup → typed goals: 2–3 goals (no AI voice) → Pomodoro work block → tracking.
- Off task ≥ 2 min?
  - No → continue.
  - Yes → group call in last 30 min? Yes → gentle nudge (to that person only). No → surprise group call, auto-ends ~60 s.
  - Back to tracking.
- Pomodoro done → continue? Yes → 5-min break → next block. No → session ends → private summary → done.

## Rules
| Rule | Value |
|---|---|
| Work block / break | 25 min / 5 min |
| Goals per person | 2–3, checked off at breaks |
| Off-task duration before call/nudge | 2 min sustained |
| Status smoothing | change only after holding ~60 s |
| Low confidence | < 0.6 counts as neutral |
| Call cooldown | 30 min per session (nudge instead) |
| Call length | auto-end ~60 s |
| Statuses | `on_task`, `off_task`, `break` (optional `stuck`) |

Current code differs on several values; see `../status.md#mismatches`.

## Summary (private, per person)
% on task · goals completed · deep-work blocks · interruptions · opt-in replay with one-line captions (one Claude call per session).
