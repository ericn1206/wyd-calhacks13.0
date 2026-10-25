import { schema, table, t, type InferSchema, type ReadonlyDbView, type ReducerCtx } from 'spacetimedb/server';
import * as E from './enums';

// ── Enums (SpacetimeDB sum types built from the shared lists in enums.ts) ──

export const SessionState = t.enum('SessionState', E.SessionState);
export const PomodoroPhase = t.enum('PomodoroPhase', E.PomodoroPhase);
export const DeviceStatus = t.enum('DeviceStatus', E.DeviceStatus);
export const AppCategory = t.enum('AppCategory', E.AppCategory);
export const PhoneState = t.enum('PhoneState', E.PhoneState);
export const StatusLabel = t.enum('StatusLabel', E.StatusLabel);
export const ReasonCode = t.enum('ReasonCode', E.ReasonCode);
export const ModelName = t.enum('ModelName', E.ModelName);
export const FocusBlockKind = t.enum('FocusBlockKind', E.FocusBlockKind);
export const ScoreEventKind = t.enum('ScoreEventKind', E.ScoreEventKind);
export const CallState = t.enum('CallState', E.CallState);
export const CallEndedReason = t.enum('CallEndedReason', E.CallEndedReason);
export const CallResponse = t.enum('CallResponse', E.CallResponse);
export const AlertKind = t.enum('AlertKind', E.AlertKind);
export const TakeoverState = t.enum('TakeoverState', E.TakeoverState);
export const TakeoverAction = t.enum('TakeoverAction', E.TakeoverAction);
export const PhoneSensorState = t.enum('PhoneSensorState', E.PhoneSensorState);
export const PhonePlatform = t.enum('PhonePlatform', E.PhonePlatform);
export const AwardKind = t.enum('AwardKind', E.AwardKind);
export const StuckState = t.enum('StuckState', E.StuckState);
export const StuckRole = t.enum('StuckRole', E.StuckRole);
export const MatchType = t.enum('MatchType', E.MatchType);

// ── Tables ──
// All session-scoped tables are private; clients read them through the
// per-sender views in index.ts, which only return rows for their own sessions.

// 1. user (public)
export const user = table(
  { name: 'user', public: true },
  {
    identity: t.identity().primaryKey(),
    displayName: t.string(),
    avatarColor: t.string(),
    createdAt: t.timestamp(),
    online: t.bool(),
  }
);

// 2. session (own session only, via my_sessions)
export const session = table(
  { name: 'session' },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string().unique(),
    name: t.string(),
    state: SessionState,
    startedAt: t.option(t.timestamp()),
    endedAt: t.option(t.timestamp()),
    pomodoroWorkSecs: t.u32(),
    pomodoroBreakSecs: t.u32(),
    currentPhase: PomodoroPhase,
    phaseStartedAt: t.option(t.timestamp()),
    cycleNumber: t.u32(),
    offTaskThresholdSecs: t.u32(),
    callCooldownSecs: t.u32(),
    maxCallSecs: t.u32(),
    scoreboardEnabled: t.bool(),
    groupCallEnabled: t.bool(),
  }
);

// 3. member (own session only)
export const member = table(
  {
    name: 'member',
    indexes: [{ accessor: 'bySessionIdentity', algorithm: 'btree', columns: ['sessionId', 'identity'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    identity: t.identity().index('btree'),
    leftAt: t.option(t.timestamp()),
    deviceStatus: DeviceStatus,
    phoneLinked: t.bool(),
    isHost: t.bool(),
    goalsSet: t.bool(),
  }
);

// 4. goal (own session only)
export const goal = table(
  { name: 'goal' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    text: t.string(),
    position: t.u8(),
    completed: t.bool(),
    completedAt: t.option(t.timestamp()),
    checkedAtBreakNumber: t.option(t.u32()),
  }
);

// 5. signal_event (private; the 10-second event)
export const signalEvent = table(
  {
    name: 'signal_event',
    indexes: [{ accessor: 'byMemberSeq', algorithm: 'btree', columns: ['memberId', 'seq'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    ts: t.timestamp().index('btree'),
    seq: t.u64(),
    facePresent: t.bool(),
    eyesClosed: t.bool(),
    lookingAway: t.bool(),
    headYaw: t.f32(),
    headPitch: t.f32(),
    postureSlouchScore: t.f32(),
    phoneInHand: t.bool(),
    facialExpression: t.option(t.string()),
    expressionConfidence: t.f32(),
    activeApp: t.string(),
    activeWindowTitle: t.option(t.string()),
    activeUrlDomain: t.option(t.string()),
    appCategory: AppCategory,
    phoneState: PhoneState,
    webcamConfidence: t.f32(),
    idleSecs: t.u32(),
    clientVersion: t.string(),
  }
);

// 6. status (own session only; AI-judged + smoothed, one row per member)
export const status = table(
  { name: 'status' },
  {
    memberId: t.u64().primaryKey(),
    sessionId: t.u64().index('btree'),
    label: StatusLabel,
    reasonCode: ReasonCode,
    confidence: t.f32(),
    since: t.timestamp(),
    lastEventId: t.u64(),
    smoothedOffTaskSecs: t.u32(),
    updatedAt: t.timestamp(),
  }
);

// 7. judgment (private; worker output log, one row per signal_event)
export const judgment = table(
  { name: 'judgment' },
  {
    id: t.u64().primaryKey().autoInc(),
    eventId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    sessionId: t.u64().index('btree'),
    rawLabel: StatusLabel,
    rawConfidence: t.f32(),
    reasonCode: ReasonCode,
    modelName: ModelName,
    latencyMs: t.u32(),
    inputTokens: t.u32(),
    outputTokens: t.u32(),
    costUsd: t.f64(),
    createdAt: t.timestamp(),
  }
);

// 8. focus_block (own session only)
export const focusBlock = table(
  { name: 'focus_block' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    kind: FocusBlockKind,
    reasonCode: t.option(ReasonCode),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    durationSecs: t.u32(),
    pomodoroCycle: t.u32(),
  }
);

// 9. score (own session only; others' rows hidden unless scoreboard_enabled)
export const score = table(
  { name: 'score' },
  {
    memberId: t.u64().primaryKey(),
    sessionId: t.u64().index('btree'),
    focusPoints: t.f64(),
    focusRatio: t.f64(),
    goalsCompleted: t.u32(),
    goalsTotal: t.u32(),
    finalScore: t.f64(),
    currentStreakSecs: t.u32(),
    bestStreakSecs: t.u32(),
    penaltiesTotal: t.f64(),
    recoveryBonusTotal: t.f64(),
    interruptionsCount: t.u32(),
    updatedAt: t.timestamp(),
  }
);

// 10. score_event (private audit trail)
export const scoreEvent = table(
  { name: 'score_event' },
  {
    id: t.u64().primaryKey().autoInc(),
    memberId: t.u64().index('btree'),
    sessionId: t.u64().index('btree'),
    ts: t.timestamp(),
    kind: ScoreEventKind,
    delta: t.f64(),
    note: t.string(),
  }
);

// 13. group_call (own session only)
export const groupCall = table(
  { name: 'group_call' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    triggeredByMemberId: t.u64().index('btree'),
    triggerReasonCode: ReasonCode,
    roomId: t.string(),
    roomUrl: t.option(t.string()),
    state: CallState,
    createdAt: t.timestamp(),
    startedAt: t.option(t.timestamp()),
    endedAt: t.option(t.timestamp()),
    maxDurationSecs: t.u32(),
    endedReason: t.option(CallEndedReason),
  }
);

// 14. call_participant (own session only)
export const callParticipant = table(
  { name: 'call_participant' },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    joinedAt: t.option(t.timestamp()),
    leftAt: t.option(t.timestamp()),
    response: CallResponse,
  }
);

// 15. call_cooldown (private)
export const callCooldown = table(
  { name: 'call_cooldown' },
  {
    sessionId: t.u64().primaryKey(),
    lastCallAt: t.timestamp(),
    callsInLastHour: t.u32(),
  }
);

// 15b. call_member_trigger (private; per-member last call/nudge trigger)
export const callMemberTrigger = table(
  { name: 'call_member_trigger' },
  {
    memberId: t.u64().primaryKey(),
    sessionId: t.u64().index('btree'),
    lastTriggeredAt: t.timestamp(),
  }
);

// 16. alert (targeted member only)
export const alert = table(
  { name: 'alert' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    targetMemberId: t.u64().index('btree'),
    kind: AlertKind,
    payloadJson: t.string(),
    createdAt: t.timestamp(),
    delivered: t.bool(),
    deliveredAt: t.option(t.timestamp()),
    factoryRunId: t.option(t.string()),
  }
);

// 17. takeover_request (own session only)
export const takeoverRequest = table(
  { name: 'takeover_request' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    requesterMemberId: t.u64().index('btree'),
    targetMemberId: t.u64().index('btree'),
    state: TakeoverState,
    action: TakeoverAction,
    createdAt: t.timestamp(),
    resolvedAt: t.option(t.timestamp()),
    requiresTargetConsent: t.bool(),
  }
);

// 18. phone_sensor (private; owner + paired phone read it via my_phone_sensor)
export const phoneSensor = table(
  { name: 'phone_sensor' },
  {
    memberId: t.u64().primaryKey(),
    sessionId: t.u64().index('btree'),
    pairingCode: t.string().unique(),
    phoneIdentity: t.option(t.identity()), // option columns can't be indexed; table is tiny
    pageVisible: t.bool(),
    lastHeartbeatAt: t.option(t.timestamp()),
    state: PhoneSensorState,
    platform: PhonePlatform,
  }
);

// 19. replay_clip_meta (private; metadata only, clip stays on device)
export const replayClipMeta = table(
  { name: 'replay_clip_meta' },
  {
    id: t.u64().primaryKey().autoInc(),
    memberId: t.u64().index('btree'),
    sessionId: t.u64().index('btree'),
    ts: t.timestamp(),
    durationSecs: t.u32(),
    reasonCode: ReasonCode,
    localPathHash: t.string(),
    deletedAfterSession: t.bool(),
  }
);

// 20. session_summary (owner only)
export const sessionSummary = table(
  { name: 'session_summary' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    totalSecs: t.u32(),
    deepWorkSecs: t.u32(),
    longestBlockSecs: t.u32(),
    interruptionCount: t.u32(),
    topDistractionCategory: t.option(AppCategory),
    goalsCompleted: t.u32(),
    goalsTotal: t.u32(),
    summaryText: t.string(),
    notabilityPdfRef: t.option(t.string()),
    createdAt: t.timestamp(),
  }
);

// 21. session_award (own session, created at session end)
export const sessionAward = table(
  { name: 'session_award' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    kind: AwardKind,
    value: t.f64(),
    note: t.string(),
  }
);

// 22. stuck_session (owner only)
export const stuckSession = table(
  { name: 'stuck_session' },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64().index('btree'),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    topic: t.string(),
    state: StuckState,
  }
);

// 23. stuck_message (owner only)
export const stuckMessage = table(
  { name: 'stuck_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    stuckId: t.u64().index('btree'),
    role: StuckRole,
    text: t.string(),
    ts: t.timestamp(),
  }
);

// 24. app_category_rule (public read; sessionId none = global default)
export const appCategoryRule = table(
  { name: 'app_category_rule', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.option(t.u64()), // option columns can't be indexed; table is tiny
    pattern: t.string(),
    matchType: MatchType,
    category: AppCategory,
    onTaskDefault: t.bool(),
  }
);

// 25. session_context (own session only)
export const sessionContext = table(
  { name: 'session_context' },
  {
    sessionId: t.u64().primaryKey(),
    topicDescription: t.string(),
    allowedDomains: t.array(t.string()),
    blockedDomains: t.array(t.string()),
  }
);

// 26. worker_heartbeat (private)
export const workerHeartbeat = table(
  { name: 'worker_heartbeat' },
  {
    workerId: t.string().primaryKey(),
    lastSeenAt: t.timestamp(),
    modelInUse: t.string(),
    queueDepth: t.u32(),
  }
);

// 27. app_setting (public read)
export const appSetting = table(
  { name: 'app_setting', public: true },
  {
    key: t.string().primaryKey(),
    valueJson: t.string(),
  }
);

// 28. focus_history_index (private; for "when do I focus best?" search)
export const focusHistoryIndex = table(
  { name: 'focus_history_index' },
  {
    id: t.u64().primaryKey().autoInc(),
    memberId: t.u64().index('btree'),
    sessionId: t.u64().index('btree'),
    hourOfDay: t.u8(),
    dayOfWeek: t.u8(),
    focusRatio: t.f64(),
    indexedAt: t.timestamp(),
  }
);

// ── Internal tables ──

// Identities allowed to act as the AI worker (write_judgment, set_summary_text, ...).
export const authorizedWorker = table(
  { name: 'authorized_worker' },
  {
    identity: t.identity().primaryKey(),
    addedAt: t.timestamp(),
  }
);

// One-shot timer for the next pomodoro phase change.
export const pomodoroTimer = table(
  { name: 'pomodoro_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    sessionId: t.u64().index('btree'),
  }
);

// Repeating 10-second timer per tracked member.
export const scoreTickTimer = table(
  { name: 'score_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    memberId: t.u64().index('btree'),
    sessionId: t.u64().index('btree'),
  }
);

// One-shot timer that auto-ends a group call after max_duration_secs.
export const callTimeoutTimer = table(
  { name: 'call_timeout_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    callId: t.u64().index('btree'),
  }
);

// One-shot timer: removes a member who stayed disconnected for the grace period.
export const disconnectTimer = table(
  { name: 'disconnect_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    memberId: t.u64().index('btree'),
  }
);

// The one live connection per identity (newest wins). A stale socket's disconnect is ignored.
export const activeConnection = table(
  { name: 'active_connection' },
  {
    identity: t.identity().primaryKey(),
    connectionId: t.connectionId(),
  }
);

const spacetimedb = schema({
  user,
  activeConnection,
  session,
  member,
  goal,
  signalEvent,
  status,
  judgment,
  focusBlock,
  score,
  scoreEvent,
  groupCall,
  callParticipant,
  callCooldown,
  callMemberTrigger,
  alert,
  takeoverRequest,
  phoneSensor,
  replayClipMeta,
  sessionSummary,
  sessionAward,
  stuckSession,
  stuckMessage,
  appCategoryRule,
  sessionContext,
  workerHeartbeat,
  appSetting,
  focusHistoryIndex,
  authorizedWorker,
  pomodoroTimer,
  scoreTickTimer,
  callTimeoutTimer,
  disconnectTimer,
});
export default spacetimedb;

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type RDb = ReadonlyDbView<InferSchema<typeof spacetimedb>>;
