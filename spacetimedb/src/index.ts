import type { Identity } from 'spacetimedb';
import { SenderError, t } from 'spacetimedb/server';
import spacetimedb, {
  AppCategory,
  CallResponse,
  PhonePlatform,
  PhoneState,
  ReasonCode,
  StatusLabel,
  ModelName,
  TakeoverAction,
  alert,
  callParticipant,
  focusBlock,
  goal,
  groupCall,
  judgment,
  member,
  phoneSensor,
  pomodoroTimer,
  replayClipMeta,
  sessionClip,
  sessionClipChunk,
  sessionCompilation,
  CompilationStatus,
  score,
  scoreTickTimer,
  callTimeoutTimer,
  disconnectTimer,
  activeConnection,
  session,
  sessionAward,
  sessionContext,
  sessionSummary,
  signalEvent,
  status,
  stuckMessage,
  stuckSession,
  takeoverRequest,
  type Ctx,
  type RDb,
} from './schema';
import {
  activeMember,
  activeMembersOf,
  applySmoothing,
  classify,
  clearDisconnectTimers,
  deleteReplayMeta,
  endCall,
  ensureTracking,
  finalizeSession,
  flipPhase,
  insertAlert,
  insertFallbackJudgment,
  isServer,
  isSessionHost,
  isWorker,
  logGoalChecked,
  maybeTriggerGroupCall,
  proposedOrRandomCode,
  randomCode,
  recomputeGoals,
  requireActiveMember,
  requireHost,
  requireServer,
  requireWorker,
  secsBetween,
  seedDefaults,
  settingNum,
  scheduleDisconnectLeave,
  schedulePomodoro,
  stopSessionTimers,
  stopTracking,
  tag,
  tickScore as runTickScore,
  workerOnline,
} from './logic';

export default spacetimedb;

// ── Lifecycle ──

export const init = spacetimedb.init(ctx => {
  seedDefaults(ctx);
  // The publisher is the first authorized worker; it can authorize others.
  if (!ctx.db.authorizedWorker.identity.find(ctx.sender)) {
    ctx.db.authorizedWorker.insert({ identity: ctx.sender, addedAt: ctx.timestamp });
  }
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  // One live connection per identity: the newest wins, so a lingering old socket can't undo it.
  if (ctx.connectionId) {
    const active = ctx.db.activeConnection.identity.find(ctx.sender);
    if (active) ctx.db.activeConnection.identity.update({ ...active, connectionId: ctx.connectionId });
    else ctx.db.activeConnection.insert({ identity: ctx.sender, connectionId: ctx.connectionId });
  }
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) {
    ctx.db.user.identity.update({ ...u, online: true });
  } else {
    ctx.db.user.insert({
      identity: ctx.sender,
      displayName: `guest-${ctx.sender.toHexString().slice(-4)}`,
      avatarColor: '#7C8CF8',
      createdAt: ctx.timestamp,
      online: true,
    });
  }
  for (const m of ctx.db.member.identity.filter(ctx.sender)) {
    if (m.leftAt !== undefined) continue;
    clearDisconnectTimers(ctx, m.id);
    ctx.db.member.id.update({ ...m, deviceStatus: tag('Connected') });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  // Only the identity's current connection going away counts; a superseded socket closing is ignored.
  const active = ctx.db.activeConnection.identity.find(ctx.sender);
  if (active && ctx.connectionId && !active.connectionId.isEqual(ctx.connectionId)) return;
  ctx.db.activeConnection.identity.delete(ctx.sender);
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) ctx.db.user.identity.update({ ...u, online: false });
  for (const m of ctx.db.member.identity.filter(ctx.sender)) {
    if (m.leftAt !== undefined) continue;
    ctx.db.member.id.update({ ...m, deviceStatus: tag('Disconnected') });
    scheduleDisconnectLeave(ctx, m.id);
  }
});

/** Grace period over: if the member is still disconnected, they leave (host passes on, empty session ends). */
export const leaveIfStillDisconnected = spacetimedb.reducer(
  { onSchedule: disconnectTimer },
  { timer: disconnectTimer.rowType },
  (ctx, { timer }) => {
    requireServer(ctx);
    const m = ctx.db.member.id.find(timer.memberId);
    if (m && m.leftAt === undefined && m.deviceStatus.tag === 'Disconnected') leaveMember(ctx, m.id);
  }
);

// ── Profile ──

export const setProfile = spacetimedb.reducer(
  { displayName: t.string(), avatarColor: t.string() },
  (ctx, { displayName, avatarColor }) => {
    const name = displayName.trim().slice(0, 40);
    if (!name) throw new SenderError('display name is required');
    const u = ctx.db.user.identity.find(ctx.sender);
    if (u) {
      ctx.db.user.identity.update({ ...u, displayName: name, avatarColor });
    } else {
      ctx.db.user.insert({ identity: ctx.sender, displayName: name, avatarColor, createdAt: ctx.timestamp, online: true });
    }
  }
);

// ── Sessions ──

const SessionSettings = t.object('SessionSettings', {
  pomodoroWorkSecs: t.option(t.u32()),
  pomodoroBreakSecs: t.option(t.u32()),
  offTaskThresholdSecs: t.option(t.u32()),
  callCooldownSecs: t.option(t.u32()),
  maxCallSecs: t.option(t.u32()),
  scoreboardEnabled: t.option(t.bool()),
  groupCallEnabled: t.option(t.bool()),
  topicDescription: t.option(t.string()),
  allowedDomains: t.option(t.array(t.string())),
  blockedDomains: t.option(t.array(t.string())),
});

export const createSession = spacetimedb.reducer(
  { name: t.string(), settings: SessionSettings, code: t.option(t.string()) },
  (ctx, { name, settings, code: proposed }) => {
    seedDefaults(ctx);
    const current = activeMember(ctx);
    if (current) leaveMember(ctx, current.member.id);

    // The app shows its proposed code before creating; keep it unless it is taken.
    const code = proposedOrRandomCode(ctx, proposed, 6, c => ctx.db.session.code.find(c) != null);
    const s = ctx.db.session.insert({
      id: 0n,
      code,
      name: name.trim().slice(0, 80) || 'Focus session',
      state: tag('Lobby'),
      startedAt: undefined,
      endedAt: undefined,
      pomodoroWorkSecs: settings.pomodoroWorkSecs ?? 1500,
      pomodoroBreakSecs: settings.pomodoroBreakSecs ?? 300,
      currentPhase: tag('Work'),
      phaseStartedAt: undefined,
      cycleNumber: 0,
      offTaskThresholdSecs: settings.offTaskThresholdSecs ?? 0,
      callCooldownSecs: settings.callCooldownSecs ?? settingNum(ctx.db, 'call_cooldown_secs'),
      maxCallSecs: settings.maxCallSecs ?? settingNum(ctx.db, 'call_max_secs'),
      scoreboardEnabled: settings.scoreboardEnabled ?? false,
      groupCallEnabled: settings.groupCallEnabled ?? true,
    });
    ctx.db.sessionContext.insert({
      sessionId: s.id,
      topicDescription: settings.topicDescription ?? '',
      allowedDomains: settings.allowedDomains ?? [],
      blockedDomains: settings.blockedDomains ?? [],
    });
    insertMember(ctx, s.id, true);
  }
);

function insertMember(ctx: Ctx, sessionId: bigint, isHost: boolean) {
  return ctx.db.member.insert({
    id: 0n,
    sessionId,
    identity: ctx.sender,
    leftAt: undefined,
    deviceStatus: tag('Connected'),
    phoneLinked: false,
    isHost,
    goalsSet: false,
  });
}

function leaveMember(ctx: Ctx, memberId: bigint) {
  const m = ctx.db.member.id.find(memberId);
  if (!m || m.leftAt !== undefined) return;
  ctx.db.member.id.update({ ...m, leftAt: ctx.timestamp, isHost: false });
  stopTracking(ctx, m.id);
  clearDisconnectTimers(ctx, m.id);

  const s = ctx.db.session.id.find(m.sessionId);
  if (!s || s.state.tag === 'Ended') return;
  const remaining = activeMembersOf(ctx.db, s.id);
  if (remaining.length === 0) {
    if (s.state.tag === 'Lobby') {
      ctx.db.session.id.update({ ...s, state: tag('Ended'), endedAt: ctx.timestamp });
    } else {
      endSessionNow(ctx, s.id);
    }
    return;
  }
  if (m.isHost) {
    // Next host = longest-standing active member (lowest row id; a rejoin gets a fresh row).
    const next = remaining.reduce((a, b) => (b.id < a.id ? b : a));
    ctx.db.member.id.update({ ...next, isHost: true });
  }
}

export const joinSession = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const s = ctx.db.session.code.find(code.trim().toUpperCase());
  if (!s || s.state.tag === 'Ended') throw new SenderError('no open session with that code');

  const current = activeMember(ctx);
  if (current && current.session.id === s.id) return;
  if (current) leaveMember(ctx, current.member.id);

  // Always a fresh row: a rejoiner goes to the back of the host line and starts with no goals.
  const m = insertMember(ctx, s.id, false);
  ensureTracking(ctx, m, ctx.db.session.id.find(s.id)!);
});

export const leaveSession = spacetimedb.reducer(ctx => {
  const { member: m } = requireActiveMember(ctx);
  leaveMember(ctx, m.id);
});

export const setGoals = spacetimedb.reducer({ goals: t.array(t.string()) }, (ctx, { goals }) => {
  const { member: m, session: s } = requireActiveMember(ctx);
  const texts = goals.map(g => g.trim().slice(0, 200)).filter(g => g.length > 0);
  if (texts.length < 1 || texts.length > 3) throw new SenderError('set 1 to 3 goals');

  for (const g of [...ctx.db.goal.memberId.filter(m.id)]) ctx.db.goal.id.delete(g.id);
  texts.forEach((text, i) => {
    ctx.db.goal.insert({
      id: 0n,
      sessionId: s.id,
      memberId: m.id,
      text,
      position: i + 1,
      completed: false,
      completedAt: undefined,
      checkedAtBreakNumber: undefined,
    });
  });
  ctx.db.member.id.update({ ...m, goalsSet: true });
  recomputeGoals(ctx, m.id);
});

export const checkGoal = spacetimedb.reducer({ goalId: t.u64(), done: t.bool() }, (ctx, { goalId, done }) => {
  const { member: m, session: s } = requireActiveMember(ctx);
  const g = ctx.db.goal.id.find(goalId);
  if (!g || g.memberId !== m.id) throw new SenderError('not your goal');
  if (g.completed === done) return;
  ctx.db.goal.id.update({
    ...g,
    completed: done,
    completedAt: done ? ctx.timestamp : undefined,
    checkedAtBreakNumber: s.currentPhase.tag === 'Break' ? s.cycleNumber : g.checkedAtBreakNumber,
  });
  logGoalChecked(ctx, m.id, s.id, done, g.text);
  recomputeGoals(ctx, m.id);
});

export const updateSessionContext = spacetimedb.reducer(
  { topicDescription: t.string(), allowedDomains: t.array(t.string()), blockedDomains: t.array(t.string()) },
  (ctx, args) => {
    const { session: s } = requireHost(ctx);
    const row = { sessionId: s.id, ...args };
    if (ctx.db.sessionContext.sessionId.find(s.id)) ctx.db.sessionContext.sessionId.update(row);
    else ctx.db.sessionContext.insert(row);
  }
);

// ── Pomodoro ──

type HostSession = ReturnType<typeof requireHost>['session'];

/** Stops a running timer: back to Lobby with a full work block, same as a fresh session. */
function stopToLobby(ctx: Ctx, s: HostSession): HostSession {
  if (s.state.tag !== 'Active' && s.state.tag !== 'Break') return s;
  stopSessionTimers(ctx, s.id);
  for (const m of activeMembersOf(ctx.db, s.id)) stopTracking(ctx, m.id);
  return ctx.db.session.id.update({ ...s, state: tag('Lobby'), currentPhase: tag('Work'), phaseStartedAt: undefined, cycleNumber: 0 });
}

/** Changing the length while the timer runs stops it (host presses Start again). */
export const setPomodoro = spacetimedb.reducer(
  { workSecs: t.u32(), breakSecs: t.u32() },
  (ctx, { workSecs, breakSecs }) => {
    const { session: host } = requireHost(ctx);
    if (host.state.tag === 'Ended') throw new SenderError('session has ended');
    if (workSecs < 60 || workSecs > 7200) throw new SenderError('work length must be 1 to 120 minutes');
    if (breakSecs < 60 || breakSecs > 3600) throw new SenderError('break length must be 1 to 60 minutes');
    const s = stopToLobby(ctx, host);
    ctx.db.session.id.update({ ...s, pomodoroWorkSecs: workSecs, pomodoroBreakSecs: breakSecs });
  }
);

export const stopPomodoro = spacetimedb.reducer(ctx => {
  const { session: s } = requireHost(ctx);
  if (s.state.tag === 'Ended') throw new SenderError('session has ended');
  stopToLobby(ctx, s);
});

export const startSession = spacetimedb.reducer(ctx => {
  const { session: s } = requireHost(ctx);
  if (s.state.tag !== 'Lobby') throw new SenderError('session already started');
  const started = ctx.db.session.id.update({
    ...s,
    state: tag('Active'),
    startedAt: ctx.timestamp,
    currentPhase: tag('Work'),
    phaseStartedAt: ctx.timestamp,
    cycleNumber: 1,
  });
  schedulePomodoro(ctx, s.id, s.pomodoroWorkSecs);
  for (const m of activeMembersOf(ctx.db, s.id)) {
    ensureTracking(ctx, m, started);
    insertAlert(ctx, s.id, m.id, 'PomodoroPhaseChange', { phase: 'Work', cycle: 1, secs: s.pomodoroWorkSecs });
  }
});

export const advancePomodoro = spacetimedb.reducer(
  { onSchedule: pomodoroTimer },
  { timer: pomodoroTimer.rowType },
  (ctx, { timer }) => {
    requireServer(ctx);
    const s = ctx.db.session.id.find(timer.sessionId);
    if (!s || (s.state.tag !== 'Active' && s.state.tag !== 'Break')) return;

    flipPhase(ctx, s);
  }
);

/** Host forces the break now (no pause, no skip). The break timer then runs as normal. */
export const takeBreak = spacetimedb.reducer(ctx => {
  const { session: s } = requireHost(ctx);
  if (s.state.tag !== 'Active') throw new SenderError('a break can only start during a work round');
  flipPhase(ctx, s);
});

function endSessionNow(ctx: Ctx, sessionId: bigint) {
  const s = ctx.db.session.id.find(sessionId);
  if (!s || s.state.tag === 'Ended') return;
  const ended = ctx.db.session.id.update({ ...s, state: tag('Ended'), endedAt: ctx.timestamp });
  stopSessionTimers(ctx, s.id);
  for (const call of [...ctx.db.groupCall.sessionId.filter(s.id)]) endCall(ctx, call, 'ManualEnd');
  for (const req of [...ctx.db.takeoverRequest.sessionId.filter(s.id)]) {
    if (req.state.tag === 'Requested' || req.state.tag === 'Approved') {
      ctx.db.takeoverRequest.id.update({ ...req, state: tag('Expired'), resolvedAt: ctx.timestamp });
    }
  }
  for (const st of [...ctx.db.stuckSession.sessionId.filter(s.id)]) {
    if (st.state.tag === 'Open') ctx.db.stuckSession.id.update({ ...st, state: tag('Resolved'), endedAt: ctx.timestamp });
  }
  finalizeSession(ctx, ended);
  deleteReplayMeta(ctx, s.id);
}

export const endSession = spacetimedb.reducer(ctx => {
  const { session: s } = requireHost(ctx);
  endSessionNow(ctx, s.id);
});

/** Normally run by end_session; callable by the host of an ended session or the worker to retry. */
export const finalizeSessionReducer = spacetimedb.reducer(
  { name: 'finalize_session' },
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const s = ctx.db.session.id.find(sessionId);
    if (!s) throw new SenderError('no such session');
    if (!isServer(ctx) && !isWorker(ctx.db, ctx.sender) && !isSessionHost(ctx.db, s.id, ctx.sender)) {
      throw new SenderError('only the host or worker may finalize');
    }
    if (s.state.tag !== 'Ended') throw new SenderError('end the session first');
    finalizeSession(ctx, s);
  }
);

export const deleteReplayMetaOnEnd = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const s = ctx.db.session.id.find(sessionId);
  if (!s) throw new SenderError('no such session');
  if (!isServer(ctx) && !isWorker(ctx.db, ctx.sender) && !isSessionHost(ctx.db, s.id, ctx.sender)) {
    throw new SenderError('only the host or worker may do this');
  }
  if (s.state.tag !== 'Ended') throw new SenderError('session has not ended');
  deleteReplayMeta(ctx, sessionId);
});

// ── Signals + judgment ──

const SignalInput = t.object('SignalInput', {
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
});

export const ingestSignal = spacetimedb.reducer({ event: SignalInput }, (ctx, { event }) => {
  const { member: m, session: s } = requireActiveMember(ctx);
  if (s.state.tag !== 'Active' && s.state.tag !== 'Break') throw new SenderError('session is not running');
  if ([...ctx.db.signalEvent.byMemberSeq.filter([m.id, event.seq])].length > 0) {
    throw new SenderError(`duplicate seq ${event.seq}`);
  }

  const app = event.activeApp.slice(0, 120);
  const title = event.activeWindowTitle?.slice(0, 300);
  const domain = event.activeUrlDomain?.toLowerCase().slice(0, 200);
  const category = event.appCategory.tag;

  // The paired phone page is the source of truth for phone state when it's fresh.
  let phoneState = event.phoneState;
  const sensor = ctx.db.phoneSensor.memberId.find(m.id);
  if (sensor && sensor.phoneIdentity && sensor.lastHeartbeatAt) {
    const fresh = secsBetween(sensor.lastHeartbeatAt, ctx.timestamp) <= settingNum(ctx.db, 'phone_heartbeat_stale_secs');
    if (fresh) phoneState = tag(sensor.pageVisible ? 'Locked_In_Page_Visible' : 'Phone_In_Use');
  }

  const ev = ctx.db.signalEvent.insert({
    id: 0n,
    sessionId: s.id,
    memberId: m.id,
    ts: ctx.timestamp,
    seq: event.seq,
    facePresent: event.facePresent,
    eyesClosed: event.eyesClosed,
    lookingAway: event.lookingAway,
    headYaw: event.headYaw,
    headPitch: event.headPitch,
    postureSlouchScore: event.postureSlouchScore,
    phoneInHand: event.phoneInHand,
    facialExpression: event.facialExpression?.slice(0, 40),
    expressionConfidence: event.expressionConfidence,
    activeApp: app,
    activeWindowTitle: title,
    activeUrlDomain: domain,
    appCategory: tag(category),
    phoneState,
    webcamConfidence: event.webcamConfidence,
    idleSecs: event.idleSecs,
    clientVersion: event.clientVersion.slice(0, 40),
  });

  if (m.deviceStatus.tag !== 'Connected') ctx.db.member.id.update({ ...m, deviceStatus: tag('Connected') });
  // The client's OnTask/OffTask verdict is the judgment: apply it and notify the group now,
  // not on the next tick. A later worker judgment for the same event replaces it.
  insertFallbackJudgment(ctx, ev);
  applySmoothing(ctx, m.id);
  maybeTriggerGroupCall(ctx, m.id);
});

export const writeJudgment = spacetimedb.reducer(
  {
    eventId: t.u64(),
    label: StatusLabel,
    reason: ReasonCode,
    confidence: t.f32(),
    model: ModelName,
    latencyMs: t.u32(),
    inputTokens: t.u32(),
    outputTokens: t.u32(),
    costUsd: t.f64(),
  },
  (ctx, a) => {
    requireWorker(ctx);
    const ev = ctx.db.signalEvent.id.find(a.eventId);
    if (!ev) throw new SenderError('no such event');
    const row = {
      eventId: ev.id,
      memberId: ev.memberId,
      sessionId: ev.sessionId,
      rawLabel: a.label,
      rawConfidence: Math.max(0, Math.min(1, a.confidence)),
      reasonCode: a.reason,
      modelName: a.model,
      latencyMs: a.latencyMs,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: a.costUsd,
      createdAt: ctx.timestamp,
    };
    // One judgment per event: a worker result replaces an earlier fallback.
    const existing = [...ctx.db.judgment.eventId.filter(ev.id)][0];
    if (existing) ctx.db.judgment.id.update({ ...existing, ...row });
    else ctx.db.judgment.insert({ id: 0n, ...row });
    applySmoothing(ctx, ev.memberId);
    maybeTriggerGroupCall(ctx, ev.memberId);
  }
);

export const applySmoothingReducer = spacetimedb.reducer(
  { name: 'apply_smoothing' },
  { memberId: t.u64() },
  (ctx, { memberId }) => {
    requireWorker(ctx);
    applySmoothing(ctx, memberId);
  }
);

export const tickScore = spacetimedb.reducer(
  { onSchedule: scoreTickTimer },
  { timer: scoreTickTimer.rowType },
  (ctx, { timer }) => {
    requireServer(ctx);
    runTickScore(ctx, timer.memberId);
  }
);

// ── Group calls ──

export const maybeTriggerGroupCallReducer = spacetimedb.reducer(
  { name: 'maybe_trigger_group_call' },
  { memberId: t.u64() },
  (ctx, { memberId }) => {
    requireWorker(ctx);
    maybeTriggerGroupCall(ctx, memberId);
  }
);

export const setCallRoomUrl = spacetimedb.reducer({ callId: t.u64(), roomUrl: t.string() }, (ctx, { callId, roomUrl }) => {
  requireWorker(ctx);
  const call = ctx.db.groupCall.id.find(callId);
  if (!call) throw new SenderError('no such call');
  ctx.db.groupCall.id.update({ ...call, roomUrl });
});

function myCallParticipant(ctx: Ctx, callId: bigint) {
  const { member: m } = requireActiveMember(ctx);
  const call = ctx.db.groupCall.id.find(callId);
  if (!call || call.sessionId !== m.sessionId) throw new SenderError('no such call in your session');
  const p = [...ctx.db.callParticipant.callId.filter(callId)].find(p => p.memberId === m.id);
  if (!p) throw new SenderError('you are not on this call');
  return { m, call, p };
}

export const respondToCall = spacetimedb.reducer({ callId: t.u64(), response: CallResponse }, (ctx, { callId, response }) => {
  const { call, p } = myCallParticipant(ctx, callId);
  if (call.state.tag === 'Ended' || call.state.tag === 'Missed') return;
  if (response.tag === 'Joined') {
    ctx.db.callParticipant.id.update({ ...p, response, joinedAt: p.joinedAt ?? ctx.timestamp, leftAt: undefined });
    if (call.state.tag === 'Ringing') ctx.db.groupCall.id.update({ ...call, state: tag('Active'), startedAt: ctx.timestamp });
  } else if (response.tag === 'Declined') {
    ctx.db.callParticipant.id.update({ ...p, response });
    const parts = [...ctx.db.callParticipant.callId.filter(callId)];
    if (parts.every(x => x.response.tag === 'Declined')) endCall(ctx, ctx.db.groupCall.id.find(callId)!, 'Declined');
  } else {
    throw new SenderError('respond with Joined or Declined');
  }
});

export const endCallReducer = spacetimedb.reducer({ name: 'end_call' }, { callId: t.u64() }, (ctx, { callId }) => {
  const { m, call, p } = myCallParticipant(ctx, callId);
  if (call.state.tag === 'Ended' || call.state.tag === 'Missed') return;
  if (m.isHost) {
    endCall(ctx, call, 'ManualEnd');
    return;
  }
  ctx.db.callParticipant.id.update({ ...p, leftAt: ctx.timestamp });
  const parts = [...ctx.db.callParticipant.callId.filter(callId)];
  const stillIn = parts.some(x => x.joinedAt !== undefined && x.leftAt === undefined);
  const stillRinging = parts.some(x => x.response.tag === 'Pending');
  if (!stillIn && !stillRinging) endCall(ctx, ctx.db.groupCall.id.find(callId)!, 'AllLeft');
});

export const callTimeout = spacetimedb.reducer(
  { onSchedule: callTimeoutTimer },
  { timer: callTimeoutTimer.rowType },
  (ctx, { timer }) => {
    requireServer(ctx);
    const call = ctx.db.groupCall.id.find(timer.callId);
    if (call) endCall(ctx, call, 'Timeout');
  }
);

// ── Alerts ──

export const markAlertDelivered = spacetimedb.reducer({ alertId: t.u64() }, (ctx, { alertId }) => {
  const a = ctx.db.alert.id.find(alertId);
  if (!a) throw new SenderError('no such alert');
  const m = ctx.db.member.id.find(a.targetMemberId);
  if (!m || !m.identity.equals(ctx.sender)) throw new SenderError('not your alert');
  if (!a.delivered) ctx.db.alert.id.update({ ...a, delivered: true, deliveredAt: ctx.timestamp });
});

// ── Takeover (requires target consent) ──

export const requestTakeover = spacetimedb.reducer(
  { targetId: t.u64(), action: TakeoverAction },
  (ctx, { targetId, action }) => {
    const { member: me, session: s } = requireActiveMember(ctx);
    const target = ctx.db.member.id.find(targetId);
    if (!target || target.sessionId !== s.id || target.leftAt !== undefined) throw new SenderError('target is not in your session');
    if (target.id === me.id) throw new SenderError('cannot target yourself');
    const req = ctx.db.takeoverRequest.insert({
      id: 0n,
      sessionId: s.id,
      requesterMemberId: me.id,
      targetMemberId: target.id,
      state: tag('Requested'),
      action,
      createdAt: ctx.timestamp,
      resolvedAt: undefined,
      requiresTargetConsent: true,
    });
    insertAlert(ctx, s.id, target.id, 'TakeoverRequest', { requestId: req.id, requesterMemberId: me.id, action: action.tag });
  }
);

export const respondTakeover = spacetimedb.reducer({ requestId: t.u64(), approve: t.bool() }, (ctx, { requestId, approve }) => {
  const { member: me } = requireActiveMember(ctx);
  const req = ctx.db.takeoverRequest.id.find(requestId);
  if (!req || req.targetMemberId !== me.id) throw new SenderError('not your request to answer');
  if (req.state.tag !== 'Requested') return;
  const expired = secsBetween(req.createdAt, ctx.timestamp) > settingNum(ctx.db, 'takeover_expire_secs');
  ctx.db.takeoverRequest.id.update({
    ...req,
    state: tag(expired ? 'Expired' : approve ? 'Approved' : 'Denied'),
    resolvedAt: ctx.timestamp,
  });
});

/** The target's client calls this after carrying out an approved action. */
export const completeTakeover = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const { member: me } = requireActiveMember(ctx);
  const req = ctx.db.takeoverRequest.id.find(requestId);
  if (!req || req.targetMemberId !== me.id) throw new SenderError('not your request');
  if (req.state.tag !== 'Approved') throw new SenderError('request is not approved');
  ctx.db.takeoverRequest.id.update({ ...req, state: tag('Executed'), resolvedAt: ctx.timestamp });
});

// ── Phone sensor ──

/** Desktop calls this to get a pairing code (read it from my_phone_sensor). */
export const startPhonePairing = spacetimedb.reducer(ctx => {
  const { member: m, session: s } = requireActiveMember(ctx);
  const pairingCode = randomCode(ctx, 6, c => ctx.db.phoneSensor.pairingCode.find(c) != null);
  const row = {
    memberId: m.id,
    sessionId: s.id,
    pairingCode,
    phoneIdentity: undefined,
    pageVisible: false,
    lastHeartbeatAt: undefined,
    state: tag('Unpaired' as const),
    platform: tag('Other' as const),
  };
  if (ctx.db.phoneSensor.memberId.find(m.id)) ctx.db.phoneSensor.memberId.update(row);
  else ctx.db.phoneSensor.insert(row);
  ctx.db.member.id.update({ ...m, phoneLinked: false });
});

/** Called from the phone page (its own identity) with the code shown on the desktop. */
export const pairPhone = spacetimedb.reducer({ code: t.string(), platform: PhonePlatform }, (ctx, { code, platform }) => {
  const sensor = ctx.db.phoneSensor.pairingCode.find(code.trim().toUpperCase());
  if (!sensor) throw new SenderError('invalid pairing code');
  const m = ctx.db.member.id.find(sensor.memberId);
  if (!m || m.leftAt !== undefined ) throw new SenderError('pairing is no longer valid');
  ctx.db.phoneSensor.memberId.update({
    ...sensor,
    phoneIdentity: ctx.sender,
    state: tag('Paired'),
    platform,
    pageVisible: true,
    lastHeartbeatAt: ctx.timestamp,
  });
  ctx.db.member.id.update({ ...m, phoneLinked: true });
});

export const phoneHeartbeat = spacetimedb.reducer({ visible: t.bool() }, (ctx, { visible }) => {
  const sensor = [...ctx.db.phoneSensor.iter()].find(p => p.phoneIdentity !== undefined && p.phoneIdentity.equals(ctx.sender));
  if (!sensor) throw new SenderError('phone is not paired');
  ctx.db.phoneSensor.memberId.update({
    ...sensor,
    pageVisible: visible,
    lastHeartbeatAt: ctx.timestamp,
    state: tag(visible ? 'Visible' : 'Hidden'),
  });
});

// ── Replay clips (metadata only; the clip stays on the laptop) ──

export const addReplayClip = spacetimedb.reducer(
  { durationSecs: t.u32(), reasonCode: ReasonCode, localPathHash: t.string() },
  (ctx, { durationSecs, reasonCode, localPathHash }) => {
    const { member: m, session: s } = requireActiveMember(ctx);
    ctx.db.replayClipMeta.insert({
      id: 0n,
      memberId: m.id,
      sessionId: s.id,
      ts: ctx.timestamp,
      durationSecs,
      reasonCode,
      localPathHash: localPathHash.slice(0, 128),
      deletedAfterSession: true,
    });
  }
);

// ── Stuck mode ──

export const startStuck = spacetimedb.reducer({ topic: t.string() }, (ctx, { topic }) => {
  const { member: m, session: s } = requireActiveMember(ctx);
  const clean = topic.trim().slice(0, 300);
  if (!clean) throw new SenderError('topic is required');
  ctx.db.stuckSession.insert({
    id: 0n,
    sessionId: s.id,
    memberId: m.id,
    startedAt: ctx.timestamp,
    endedAt: undefined,
    topic: clean,
    state: tag('Open'),
  });
});

/** The owner posts as User; the AI worker posts guiding questions as Assistant. */
export const postStuckMessage = spacetimedb.reducer({ stuckId: t.u64(), text: t.string() }, (ctx, { stuckId, text }) => {
  const stuck = ctx.db.stuckSession.id.find(stuckId);
  if (!stuck || stuck.state.tag !== 'Open') throw new SenderError('no open stuck session');
  const owner = ctx.db.member.id.find(stuck.memberId);
  const asOwner = owner !== null && owner !== undefined && owner.identity.equals(ctx.sender);
  if (!asOwner && !isWorker(ctx.db, ctx.sender)) throw new SenderError('not your stuck session');
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new SenderError('empty message');
  ctx.db.stuckMessage.insert({ id: 0n, stuckId, role: tag(asOwner ? 'User' : 'Assistant'), text: clean, ts: ctx.timestamp });
});

export const resolveStuck = spacetimedb.reducer({ stuckId: t.u64() }, (ctx, { stuckId }) => {
  const stuck = ctx.db.stuckSession.id.find(stuckId);
  const owner = stuck ? ctx.db.member.id.find(stuck.memberId) : undefined;
  if (!stuck || !owner || !owner.identity.equals(ctx.sender)) throw new SenderError('not your stuck session');
  if (stuck.state.tag === 'Open') ctx.db.stuckSession.id.update({ ...stuck, state: tag('Resolved'), endedAt: ctx.timestamp });
});

// ── Worker-only ──

export const authorizeWorker = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  requireWorker(ctx);
  if (!ctx.db.authorizedWorker.identity.find(identity)) {
    ctx.db.authorizedWorker.insert({ identity, addedAt: ctx.timestamp });
  }
});

export const reportWorkerHeartbeat = spacetimedb.reducer(
  { workerId: t.string(), modelInUse: t.string(), queueDepth: t.u32() },
  (ctx, { workerId, modelInUse, queueDepth }) => {
    requireWorker(ctx);
    const row = { workerId, lastSeenAt: ctx.timestamp, modelInUse, queueDepth };
    if (ctx.db.workerHeartbeat.workerId.find(workerId)) ctx.db.workerHeartbeat.workerId.update(row);
    else ctx.db.workerHeartbeat.insert(row);
  }
);

export const setSummaryText = spacetimedb.reducer({ summaryId: t.u64(), text: t.string() }, (ctx, { summaryId, text }) => {
  requireWorker(ctx);
  const sum = ctx.db.sessionSummary.id.find(summaryId);
  if (!sum) throw new SenderError('no such summary');
  ctx.db.sessionSummary.id.update({ ...sum, summaryText: text.slice(0, 4000) });
});

/**
 * Re-runs seeding (missing settings / default rules only). Useful after a migration publish,
 * where init doesn't run: if no worker exists yet, the caller becomes the first one.
 */
export const seedDefaultsReducer = spacetimedb.reducer({ name: 'seed_defaults' }, ctx => {
  if ([...ctx.db.authorizedWorker.iter()].length === 0) {
    ctx.db.authorizedWorker.insert({ identity: ctx.sender, addedAt: ctx.timestamp });
  }
  requireWorker(ctx);
  seedDefaults(ctx);
});

// ── Views: each client sees only its own sessions ──
// "My sessions" = every session the sender has a member row in.

type ViewDb = RDb;
type Sender = Identity;

/** Sessions the sender may read: ones they are still in, plus ended ones (summary, awards, scores). */
function mySessionIds(db: ViewDb, sender: Sender): bigint[] {
  const ids = [...db.member.identity.filter(sender)]
    .filter(m => m.leftAt === undefined || db.session.id.find(m.sessionId)?.state.tag === 'Ended')
    .map(m => m.sessionId);
  return [...new Set(ids)];
}

function myMemberIds(db: ViewDb, sender: Sender): Set<bigint> {
  return new Set([...db.member.identity.filter(sender)].map(m => m.id));
}

export const mySessions = spacetimedb.view({ name: 'my_sessions', public: true }, t.array(session.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => {
    const s = ctx.db.session.id.find(id);
    return s ? [s] : [];
  })
);

export const mySessionMembers = spacetimedb.view({ name: 'my_session_members', public: true }, t.array(member.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.member.sessionId.filter(id)])
);

export const mySessionGoals = spacetimedb.view({ name: 'my_session_goals', public: true }, t.array(goal.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.goal.sessionId.filter(id)])
);

export const mySessionStatuses = spacetimedb.view({ name: 'my_session_statuses', public: true }, t.array(status.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.status.sessionId.filter(id)])
);

export const mySessionFocusBlocks = spacetimedb.view(
  { name: 'my_session_focus_blocks', public: true },
  t.array(focusBlock.rowType),
  ctx => mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.focusBlock.sessionId.filter(id)])
);

/** Own score always; other members' scores only when the session's scoreboard is enabled. */
export const mySessionScores = spacetimedb.view({ name: 'my_session_scores', public: true }, t.array(score.rowType), ctx => {
  const mine = myMemberIds(ctx.db, ctx.sender);
  return mySessionIds(ctx.db, ctx.sender).flatMap(id => {
    const s = ctx.db.session.id.find(id);
    return [...ctx.db.score.sessionId.filter(id)].filter(sc => mine.has(sc.memberId) || (s?.scoreboardEnabled ?? false));
  });
});

export const mySessionGroupCalls = spacetimedb.view({ name: 'my_session_group_calls', public: true }, t.array(groupCall.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.groupCall.sessionId.filter(id)])
);

export const mySessionCallParticipants = spacetimedb.view(
  { name: 'my_session_call_participants', public: true },
  t.array(callParticipant.rowType),
  ctx =>
    mySessionIds(ctx.db, ctx.sender).flatMap(id =>
      [...ctx.db.groupCall.sessionId.filter(id)].flatMap(c => [...ctx.db.callParticipant.callId.filter(c.id)])
    )
);

export const myAlerts = spacetimedb.view({ name: 'my_alerts', public: true }, t.array(alert.rowType), ctx =>
  [...myMemberIds(ctx.db, ctx.sender)].flatMap(id => [...ctx.db.alert.targetMemberId.filter(id)])
);

export const mySessionTakeoverRequests = spacetimedb.view(
  { name: 'my_session_takeover_requests', public: true },
  t.array(takeoverRequest.rowType),
  ctx => mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.takeoverRequest.sessionId.filter(id)])
);

export const mySessionAwards = spacetimedb.view({ name: 'my_session_awards', public: true }, t.array(sessionAward.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id => [...ctx.db.sessionAward.sessionId.filter(id)])
);

export const mySessionContexts = spacetimedb.view(
  { name: 'my_session_contexts', public: true },
  t.array(sessionContext.rowType),
  ctx =>
    mySessionIds(ctx.db, ctx.sender).flatMap(id => {
      const c = ctx.db.sessionContext.sessionId.find(id);
      return c ? [c] : [];
    })
);

// Owner-only views.

export const mySessionSummaries = spacetimedb.view(
  { name: 'my_session_summaries', public: true },
  t.array(sessionSummary.rowType),
  ctx => [...myMemberIds(ctx.db, ctx.sender)].flatMap(id => [...ctx.db.sessionSummary.memberId.filter(id)])
);

export const myStuckSessions = spacetimedb.view({ name: 'my_stuck_sessions', public: true }, t.array(stuckSession.rowType), ctx =>
  [...myMemberIds(ctx.db, ctx.sender)].flatMap(id => [...ctx.db.stuckSession.memberId.filter(id)])
);

export const myStuckMessages = spacetimedb.view({ name: 'my_stuck_messages', public: true }, t.array(stuckMessage.rowType), ctx =>
  [...myMemberIds(ctx.db, ctx.sender)].flatMap(id =>
    [...ctx.db.stuckSession.memberId.filter(id)].flatMap(st => [...ctx.db.stuckMessage.stuckId.filter(st.id)])
  )
);

/** Visible to the member who owns it and to the phone paired with it. */
export const myPhoneSensor = spacetimedb.view({ name: 'my_phone_sensor', public: true }, t.array(phoneSensor.rowType), ctx => {
  const mine = myMemberIds(ctx.db, ctx.sender);
  return [...ctx.db.phoneSensor.iter()].filter(
    p => mine.has(p.memberId) || (p.phoneIdentity !== undefined && p.phoneIdentity.equals(ctx.sender))
  );
});

export const myReplayClips = spacetimedb.view({ name: 'my_replay_clips', public: true }, t.array(replayClipMeta.rowType), ctx =>
  [...myMemberIds(ctx.db, ctx.sender)].flatMap(id => [...ctx.db.replayClipMeta.memberId.filter(id)])
);

/** Clip metadata for every session the caller may read: finished clips of anyone, plus the caller's own uploads in progress. No bytes. */
export const mySessionClips = spacetimedb.view({ name: 'my_session_clips', public: true }, t.array(sessionClip.rowType), ctx =>
  mySessionIds(ctx.db, ctx.sender).flatMap(id =>
    [...ctx.db.sessionClip.sessionId.filter(id)].filter(c => c.complete || c.identity.equals(ctx.sender))
  )
);

// ── Session clips: 30 s webcam clip of an off-task moment (10 s before, 20 s after) ──
// Flow: begin_session_clip → upload_clip_chunk × chunkCount → finish_session_clip. The clip is
// finished locally before upload starts, so it may arrive after the session ended or the member left.

const CLIP_MIME = 'video/mp4';
const CLIP_MAX_BYTES = 12 * 1024 * 1024;
const CLIP_CHUNK_MAX_BYTES = 256 * 1024;
const CLIP_MAX_CHUNKS = 64;
const CLIP_MAX_MS = 60_000;
const CLIPS_PER_MEMBER = 20;
const CLIP_GRACE_SECS = 600;

/** The caller's newest member row, as long as its session is live or ended/left within the grace window. */
function clipMember(ctx: Ctx) {
  let latest: ReturnType<typeof ctx.db.member.id.find> = null;
  for (const m of ctx.db.member.identity.filter(ctx.sender)) if (!latest || m.id > latest.id) latest = m;
  const s = latest && ctx.db.session.id.find(latest.sessionId);
  if (!latest || !s) throw new SenderError('you are not in a session');
  const over = s.state.tag === 'Ended' ? s.endedAt : latest.leftAt;
  if (over && secsBetween(over, ctx.timestamp) > CLIP_GRACE_SECS) throw new SenderError('session is over; clip too late');
  return latest;
}

function ownClip(ctx: Ctx, clipKey: string) {
  const clip = ctx.db.sessionClip.clipKey.find(clipKey);
  if (!clip || !clip.identity.equals(ctx.sender)) throw new SenderError('unknown clip');
  return clip;
}

export const beginSessionClip = spacetimedb.reducer(
  {
    clipKey: t.string(),
    momentAtMs: t.u64(),
    startedAtMs: t.u64(),
    durationMs: t.u32(),
    width: t.u16(),
    height: t.u16(),
    fps: t.u8(),
    mime: t.string(),
    sizeBytes: t.u32(),
    chunkCount: t.u32(),
  },
  (ctx, a) => {
    if (a.clipKey.length < 8 || a.clipKey.length > 64) throw new SenderError('bad clip key');
    if (a.mime !== CLIP_MIME) throw new SenderError(`clip must be ${CLIP_MIME}`);
    if (a.sizeBytes === 0 || a.sizeBytes > CLIP_MAX_BYTES) throw new SenderError('clip too large');
    if (a.chunkCount === 0 || a.chunkCount > CLIP_MAX_CHUNKS) throw new SenderError('bad chunk count');
    if (a.durationMs === 0 || a.durationMs > CLIP_MAX_MS) throw new SenderError('bad clip duration');
    const m = clipMember(ctx);
    // A retry of the same key restarts the upload from scratch.
    const existing = ctx.db.sessionClip.clipKey.find(a.clipKey);
    if (existing) {
      if (!existing.identity.equals(ctx.sender)) throw new SenderError('clip key taken');
      for (const c of [...ctx.db.sessionClipChunk.clipId.filter(existing.id)]) ctx.db.sessionClipChunk.id.delete(c.id);
      ctx.db.sessionClip.id.delete(existing.id);
    } else if ([...ctx.db.sessionClip.memberId.filter(m.id)].length >= CLIPS_PER_MEMBER) {
      throw new SenderError('clip limit reached for this session');
    }
    ctx.db.sessionClip.insert({
      id: 0n,
      clipKey: a.clipKey,
      sessionId: m.sessionId,
      memberId: m.id,
      identity: ctx.sender,
      momentAtMs: a.momentAtMs,
      startedAtMs: a.startedAtMs,
      durationMs: a.durationMs,
      width: a.width,
      height: a.height,
      fps: a.fps,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      chunkCount: a.chunkCount,
      receivedChunks: 0,
      complete: false,
      createdAt: ctx.timestamp,
    });
  }
);

export const uploadClipChunk = spacetimedb.reducer(
  { clipKey: t.string(), seq: t.u32(), data: t.byteArray() },
  (ctx, { clipKey, seq, data }) => {
    const clip = ownClip(ctx, clipKey);
    if (clip.complete) throw new SenderError('clip already finished');
    if (seq >= clip.chunkCount) throw new SenderError('chunk out of range');
    if (data.length === 0 || data.length > CLIP_CHUNK_MAX_BYTES) throw new SenderError('bad chunk size');
    const dup = [...ctx.db.sessionClipChunk.clipId.filter(clip.id)].find(c => c.seq === seq);
    if (dup) {
      ctx.db.sessionClipChunk.id.update({ ...dup, data });
      return;
    }
    ctx.db.sessionClipChunk.insert({ id: 0n, clipId: clip.id, seq, data });
    ctx.db.sessionClip.id.update({ ...clip, receivedChunks: clip.receivedChunks + 1 });
  }
);

export const finishSessionClip = spacetimedb.reducer({ clipKey: t.string() }, (ctx, { clipKey }) => {
  const clip = ownClip(ctx, clipKey);
  if (clip.complete) return;
  const chunks = [...ctx.db.sessionClipChunk.clipId.filter(clip.id)];
  const bytes = chunks.reduce((n, c) => n + c.data.length, 0);
  if (chunks.length !== clip.chunkCount || bytes !== clip.sizeBytes) {
    throw new SenderError(`clip incomplete: ${chunks.length}/${clip.chunkCount} chunks, ${bytes}/${clip.sizeBytes} bytes`);
  }
  ctx.db.sessionClip.id.update({ ...clip, complete: true });
});

/** Compilation of the session's clips, for every session the caller may read. */
export const mySessionCompilations = spacetimedb.view(
  { name: 'my_session_compilations', public: true },
  t.array(sessionCompilation.rowType),
  ctx =>
    mySessionIds(ctx.db, ctx.sender).flatMap(id => {
      const c = ctx.db.sessionCompilation.sessionId.find(id);
      return c ? [c] : [];
    })
);

/** Clip worker writes the state of a session's compilation. `clipCount` = clips in the video at `url`. */
export const setSessionCompilation = spacetimedb.reducer(
  { sessionId: t.u64(), status: CompilationStatus, clipCount: t.u32(), url: t.option(t.string()), error: t.option(t.string()) },
  (ctx, { sessionId, status, clipCount, url, error }) => {
    requireWorker(ctx);
    if (!ctx.db.session.id.find(sessionId)) throw new SenderError('unknown session');
    if (status.tag === 'Ready' && !url) throw new SenderError('a Ready compilation needs a url');
    const row = { sessionId, status, clipCount, url, error: error?.slice(0, 300), updatedAt: ctx.timestamp };
    if (ctx.db.sessionCompilation.sessionId.find(sessionId)) ctx.db.sessionCompilation.sessionId.update(row);
    else ctx.db.sessionCompilation.insert(row);
  }
);

/** Ended sessions whose complete clips are not yet in a Ready compilation of the same size, with those clips. */
function sessionsToCompile(db: ViewDb) {
  const bySession = new Map<bigint, ReturnType<typeof db.sessionClip.iter> extends Iterable<infer C> ? C[] : never>();
  for (const c of db.sessionClip.iter()) {
    if (!c.complete) continue;
    bySession.set(c.sessionId, [...(bySession.get(c.sessionId) ?? []), c]);
  }
  return [...bySession].flatMap(([sessionId, clips]) => {
    const s = db.session.id.find(sessionId);
    if (!s || s.state.tag !== 'Ended') return [];
    const done = db.sessionCompilation.sessionId.find(sessionId);
    if (done && done.status.tag === 'Ready' && done.clipCount === clips.length) return [];
    return [{ session: s, clips }];
  });
}

// Worker-only views (empty for everyone else).

export const workerEndedSessions = spacetimedb.view({ name: 'worker_ended_sessions', public: true }, t.array(session.rowType), ctx =>
  isWorker(ctx.db, ctx.sender) ? sessionsToCompile(ctx.db).map(x => x.session) : []
);

export const workerSessionClips = spacetimedb.view({ name: 'worker_session_clips', public: true }, t.array(sessionClip.rowType), ctx =>
  isWorker(ctx.db, ctx.sender) ? sessionsToCompile(ctx.db).flatMap(x => x.clips) : []
);

/** Video bytes of the clips above (large: only the clip compiler subscribes). */
export const workerSessionClipChunks = spacetimedb.view(
  { name: 'worker_session_clip_chunks', public: true },
  t.array(sessionClipChunk.rowType),
  ctx =>
    isWorker(ctx.db, ctx.sender)
      ? sessionsToCompile(ctx.db).flatMap(x => x.clips.flatMap(c => [...ctx.db.sessionClipChunk.clipId.filter(c.id)]))
      : []
);

export const workerSessionCompilations = spacetimedb.view(
  { name: 'worker_session_compilations', public: true },
  t.array(sessionCompilation.rowType),
  ctx => (isWorker(ctx.db, ctx.sender) ? [...ctx.db.sessionCompilation.iter()] : [])
);

function liveSessionIds(db: ViewDb): bigint[] {
  return [...db.session.iter()].filter(s => s.state.tag !== 'Ended').map(s => s.id);
}

/** Signal events in running sessions that have no judgment yet. */
export const workerPendingSignalEvents = spacetimedb.view(
  { name: 'worker_pending_signal_events', public: true },
  t.array(signalEvent.rowType),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return liveSessionIds(ctx.db).flatMap(id =>
      [...ctx.db.signalEvent.sessionId.filter(id)].filter(ev => [...ctx.db.judgment.eventId.filter(ev.id)].length === 0)
    );
  }
);

export const workerPendingSummaries = spacetimedb.view(
  { name: 'worker_pending_summaries', public: true },
  t.array(sessionSummary.rowType),
  ctx => (isWorker(ctx.db, ctx.sender) ? [...ctx.db.sessionSummary.iter()].filter(s => s.summaryText === '') : [])
);

/** Goals for sessions with pending summaries, so the worker can write the recap. */
export const workerSummaryGoals = spacetimedb.view({ name: 'worker_summary_goals', public: true }, t.array(goal.rowType), ctx => {
  if (!isWorker(ctx.db, ctx.sender)) return [];
  const memberIds = new Set([...ctx.db.sessionSummary.iter()].filter(s => s.summaryText === '').map(s => s.memberId));
  return [...memberIds].flatMap(id => [...ctx.db.goal.memberId.filter(id)]);
});

export const workerSessionContexts = spacetimedb.view(
  { name: 'worker_session_contexts', public: true },
  t.array(sessionContext.rowType),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return liveSessionIds(ctx.db).flatMap(id => {
      const c = ctx.db.sessionContext.sessionId.find(id);
      return c ? [c] : [];
    });
  }
);

export const workerOpenStuckMessages = spacetimedb.view(
  { name: 'worker_open_stuck_messages', public: true },
  t.array(stuckMessage.rowType),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return [...ctx.db.stuckSession.iter()]
      .filter(s => s.state.tag === 'Open')
      .flatMap(s => [...ctx.db.stuckMessage.stuckId.filter(s.id)]);
  }
);

export const workerOpenStuckSessions = spacetimedb.view(
  { name: 'worker_open_stuck_sessions', public: true },
  t.array(stuckSession.rowType),
  ctx => (isWorker(ctx.db, ctx.sender) ? [...ctx.db.stuckSession.iter()].filter(s => s.state.tag === 'Open') : [])
);

// Judgment log is private; the worker can read back what it wrote.
export const workerRecentJudgments = spacetimedb.view(
  { name: 'worker_recent_judgments', public: true },
  t.array(judgment.rowType),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return liveSessionIds(ctx.db).flatMap(id => [...ctx.db.judgment.sessionId.filter(id)]);
  }
);
