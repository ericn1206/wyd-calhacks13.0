// Shared reducer logic. Nothing here is a module export; index.ts wires it up.
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import type { Ctx, RDb } from './schema';
import type * as E from './enums';

type Member = NonNullable<ReturnType<Ctx['db']['member']['id']['find']>>;
type Session = NonNullable<ReturnType<Ctx['db']['session']['id']['find']>>;
type Status = NonNullable<ReturnType<Ctx['db']['status']['memberId']['find']>>;
type GroupCall = NonNullable<ReturnType<Ctx['db']['groupCall']['id']['find']>>;
type SignalEvent = NonNullable<ReturnType<Ctx['db']['signalEvent']['id']['find']>>;

export const tag = <T extends string>(t: T) => ({ tag: t });

// ── Time ──

const MICROS = 1_000_000n;

export function secsBetween(from: Timestamp, to: Timestamp): number {
  const d = to.microsSinceUnixEpoch - from.microsSinceUnixEpoch;
  return d <= 0n ? 0 : Number(d / MICROS);
}

export function addSecs(ts: Timestamp, secs: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(Math.round(secs)) * MICROS);
}

// ── Settings + seeds ──

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  smoothing_hold_secs: 60,
  low_confidence_threshold: 0.5,
  event_interval_secs: 10,
  call_cooldown_secs: 600,
  call_max_secs: 90,
  quick_recovery_window_secs: 30,
  // Extra knobs used by the module (not in the original seed list).
  streak_bonus_every_secs: 300,
  worker_stale_secs: 30,
  fallback_judge_after_secs: 20,
  phone_heartbeat_stale_secs: 30,
  takeover_expire_secs: 120,
  call_room_base_url: '',
};

const DEFAULT_RULES: Array<{ pattern: string; matchType: E.MatchType; category: E.AppCategory; onTask: boolean }> = [
  { pattern: 'youtube.com', matchType: 'Domain', category: 'OffTask', onTask: false },
  { pattern: 'tiktok.com', matchType: 'Domain', category: 'OffTask', onTask: false },
  { pattern: 'instagram.com', matchType: 'Domain', category: 'OffTask', onTask: false },
  { pattern: 'reddit.com', matchType: 'Domain', category: 'OffTask', onTask: false },
  { pattern: 'YouTube', matchType: 'TitleRegex', category: 'OffTask', onTask: false },
  { pattern: 'TikTok', matchType: 'TitleRegex', category: 'OffTask', onTask: false },
  { pattern: 'Instagram', matchType: 'TitleRegex', category: 'OffTask', onTask: false },
  { pattern: 'Reddit', matchType: 'TitleRegex', category: 'OffTask', onTask: false },
  { pattern: 'Code', matchType: 'App', category: 'OnTask', onTask: true },
  { pattern: 'Visual Studio Code', matchType: 'App', category: 'OnTask', onTask: true },
  { pattern: 'docs.google.com', matchType: 'Domain', category: 'OnTask', onTask: true },
  { pattern: 'Google Docs', matchType: 'TitleRegex', category: 'OnTask', onTask: true },
  { pattern: 'Notion', matchType: 'App', category: 'OnTask', onTask: true },
  { pattern: 'notion.so', matchType: 'Domain', category: 'OnTask', onTask: true },
  { pattern: 'instructure.com', matchType: 'Domain', category: 'OnTask', onTask: true },
  { pattern: 'Canvas', matchType: 'TitleRegex', category: 'OnTask', onTask: true },
];

/** Idempotent: inserts missing settings and, if no global rules exist, the default rules. */
export function seedDefaults(ctx: Ctx) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!ctx.db.appSetting.key.find(key)) {
      ctx.db.appSetting.insert({ key, valueJson: JSON.stringify(value) });
    }
  }
  const hasGlobalRules = [...ctx.db.appCategoryRule.iter()].some(r => r.sessionId === undefined);
  if (!hasGlobalRules) {
    for (const r of DEFAULT_RULES) {
      ctx.db.appCategoryRule.insert({
        id: 0n,
        sessionId: undefined,
        pattern: r.pattern,
        matchType: tag(r.matchType),
        category: tag(r.category),
        onTaskDefault: r.onTask,
      });
    }
  }
}

function setting(db: RDb, key: string): unknown {
  const row = db.appSetting.key.find(key);
  if (row) {
    try {
      return JSON.parse(row.valueJson);
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_SETTINGS[key];
}

export function settingNum(db: RDb, key: string): number {
  const v = Number(setting(db, key));
  return Number.isFinite(v) ? v : Number(DEFAULT_SETTINGS[key] ?? 0);
}

export function settingStr(db: RDb, key: string): string {
  const v = setting(db, key);
  return typeof v === 'string' ? v : '';
}

// ── Auth ──

export function isServer(ctx: Ctx): boolean {
  return ctx.sender.equals(ctx.databaseIdentity);
}

export function isWorker(db: RDb, sender: Ctx['sender']): boolean {
  return db.authorizedWorker.identity.find(sender) != null;
}

export function requireWorker(ctx: Ctx) {
  if (!isServer(ctx) && !isWorker(ctx.db, ctx.sender)) throw new SenderError('only the AI worker may call this');
}

export function requireServer(ctx: Ctx) {
  if (!isServer(ctx)) throw new SenderError('only the server scheduler may call this');
}

// ── Membership ──

/** The sender's current membership: not left, in a session that hasn't ended. */
export function activeMember(ctx: Ctx): { member: Member; session: Session } | undefined {
  for (const m of ctx.db.member.identity.filter(ctx.sender)) {
    if (m.leftAt !== undefined) continue;
    const s = ctx.db.session.id.find(m.sessionId);
    if (s && s.state.tag !== 'Ended') return { member: m, session: s };
  }
  return undefined;
}

export function requireActiveMember(ctx: Ctx) {
  const found = activeMember(ctx);
  if (!found) throw new SenderError('you are not in an active session');
  return found;
}

export function activeMembersOf(db: RDb, sessionId: bigint): Member[] {
  return [...db.member.sessionId.filter(sessionId)].filter(m => m.leftAt === undefined);
}

export function requireHost(ctx: Ctx) {
  const found = requireActiveMember(ctx);
  if (!found.member.isHost) throw new SenderError('only the host may do this');
  return found;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(ctx: Ctx, len: number, taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < len; i++) code += CODE_ALPHABET[ctx.random.integerInRange(0, CODE_ALPHABET.length - 1)];
    if (!taken(code)) return code;
  }
  throw new SenderError('could not generate a unique code');
}

// ── Alerts ──

export function insertAlert(ctx: Ctx, sessionId: bigint, targetMemberId: bigint, kind: E.AlertKind, payload: object) {
  ctx.db.alert.insert({
    id: 0n,
    sessionId,
    targetMemberId,
    kind: tag(kind),
    payloadJson: JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    createdAt: ctx.timestamp,
    delivered: false,
    deliveredAt: undefined,
    factoryRunId: undefined,
  });
}

// ── Tracking lifecycle (status, score, 10 s tick timer) ──

/** Creates status/score rows and the per-member tick timer if missing. Safe to call repeatedly. */
export function ensureTracking(ctx: Ctx, m: Member, s: Session) {
  if (m.leftAt !== undefined) return;
  if (s.state.tag !== 'Active' && s.state.tag !== 'Break') return;

  if (!ctx.db.status.memberId.find(m.id)) {
    ctx.db.status.insert({
      memberId: m.id,
      sessionId: s.id,
      label: tag(s.currentPhase.tag === 'Break' ? 'Break' : 'Unknown'),
      reasonCode: tag('Unknown'),
      confidence: 0,
      since: ctx.timestamp,
      lastEventId: 0n,
      smoothedOffTaskSecs: 0,
      updatedAt: ctx.timestamp,
    });
  }
  if (!ctx.db.score.memberId.find(m.id)) {
    const goals = [...ctx.db.goal.memberId.filter(m.id)];
    ctx.db.score.insert({
      memberId: m.id,
      sessionId: s.id,
      focusPoints: 0,
      focusRatio: 0,
      goalsCompleted: goals.filter(g => g.completed).length,
      goalsTotal: goals.length,
      finalScore: 0,
      currentStreakSecs: 0,
      bestStreakSecs: 0,
      penaltiesTotal: 0,
      recoveryBonusTotal: 0,
      interruptionsCount: 0,
      updatedAt: ctx.timestamp,
    });
  }
  if ([...ctx.db.scoreTickTimer.memberId.filter(m.id)].length === 0) {
    const interval = settingNum(ctx.db, 'event_interval_secs');
    ctx.db.scoreTickTimer.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(BigInt(interval) * MICROS),
      memberId: m.id,
      sessionId: s.id,
    });
  }
}

export function stopTracking(ctx: Ctx, memberId: bigint) {
  for (const timer of [...ctx.db.scoreTickTimer.memberId.filter(memberId)]) {
    ctx.db.scoreTickTimer.scheduledId.delete(timer.scheduledId);
  }
  closeOpenBlocks(ctx, memberId, ctx.timestamp);
}

export function stopSessionTimers(ctx: Ctx, sessionId: bigint) {
  for (const timer of [...ctx.db.pomodoroTimer.sessionId.filter(sessionId)]) {
    ctx.db.pomodoroTimer.scheduledId.delete(timer.scheduledId);
  }
  for (const timer of [...ctx.db.scoreTickTimer.sessionId.filter(sessionId)]) {
    ctx.db.scoreTickTimer.scheduledId.delete(timer.scheduledId);
  }
}

export function schedulePomodoro(ctx: Ctx, sessionId: bigint, afterSecs: number) {
  for (const timer of [...ctx.db.pomodoroTimer.sessionId.filter(sessionId)]) {
    ctx.db.pomodoroTimer.scheduledId.delete(timer.scheduledId);
  }
  ctx.db.pomodoroTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(addSecs(ctx.timestamp, afterSecs).microsSinceUnixEpoch),
    sessionId,
  });
}

// ── Categorization (rules before models) ──

function ruleMatches(rule: { pattern: string; matchType: { tag: E.MatchType } }, app: string, domain?: string, title?: string) {
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType.tag) {
    case 'App':
      return app.toLowerCase() === p;
    case 'Domain': {
      const d = (domain ?? '').toLowerCase();
      return d === p || d.endsWith('.' + p);
    }
    case 'TitleRegex':
      try {
        return title !== undefined && new RegExp(rule.pattern, 'i').test(title);
      } catch {
        return false;
      }
  }
}

/** Session rules win over global rules. Returns undefined if nothing matches. */
export function classify(db: RDb, sessionId: bigint, app: string, domain?: string, title?: string): E.AppCategory | undefined {
  const rules = [...db.appCategoryRule.iter()];
  const ordered = [
    ...rules.filter(r => r.sessionId === sessionId),
    ...rules.filter(r => r.sessionId === undefined),
  ];
  // Domain and app rules are more specific than title regexes.
  for (const type of ['Domain', 'App', 'TitleRegex'] as const) {
    const hit = ordered.find(r => r.matchType.tag === type && ruleMatches(r, app, domain, title));
    if (hit) return hit.category.tag;
  }
  return undefined;
}

// ── Fallback judgment (used when the worker is offline or slow) ──

export function ruleJudge(
  db: RDb,
  ev: SignalEvent
): { label: E.StatusLabel; reason: E.ReasonCode; confidence: number } {
  const ctxRow = db.sessionContext.sessionId.find(ev.sessionId);
  const domain = ev.activeUrlDomain?.toLowerCase();
  const domainIn = (list: string[]) => domain !== undefined && list.some(d => domain === d || domain.endsWith('.' + d));

  if (!ev.facePresent && ev.webcamConfidence > 0) return { label: 'Away', reason: 'Left_Seat', confidence: 0.8 };
  if (ev.idleSecs >= 180) return { label: 'Away', reason: 'Idle', confidence: 0.7 };
  if (ev.phoneState.tag === 'Phone_In_Use' || ev.phoneInHand) return { label: 'OffTask', reason: 'Phone', confidence: 0.8 };
  if (ctxRow && domainIn(ctxRow.blockedDomains)) return { label: 'OffTask', reason: 'Distracting_App', confidence: 0.9 };
  if (ctxRow && domainIn(ctxRow.allowedDomains)) return { label: 'Focused', reason: 'Unknown', confidence: 0.8 };
  if (ev.appCategory.tag === 'OffTask') return { label: 'OffTask', reason: 'Distracting_App', confidence: 0.8 };
  if (ev.eyesClosed) return { label: 'OffTask', reason: 'Eyes_Closed', confidence: 0.6 };
  if (ev.lookingAway) return { label: 'OffTask', reason: 'Looking_Away', confidence: 0.55 };
  return { label: 'Focused', reason: 'Unknown', confidence: 0.8 };
}

export function insertFallbackJudgment(ctx: Ctx, ev: SignalEvent) {
  const j = ruleJudge(ctx.db, ev);
  ctx.db.judgment.insert({
    id: 0n,
    eventId: ev.id,
    memberId: ev.memberId,
    sessionId: ev.sessionId,
    rawLabel: tag(j.label),
    rawConfidence: j.confidence,
    reasonCode: tag(j.reason),
    modelName: tag('Fallback'),
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    createdAt: ctx.timestamp,
  });
}

export function workerOnline(ctx: Ctx): boolean {
  const stale = settingNum(ctx.db, 'worker_stale_secs');
  return [...ctx.db.workerHeartbeat.iter()].some(h => secsBetween(h.lastSeenAt, ctx.timestamp) <= stale);
}

/** Judges any of the member's events the worker hasn't labelled in time. */
function fallbackJudgeStale(ctx: Ctx, memberId: bigint) {
  const after = settingNum(ctx.db, 'fallback_judge_after_secs');
  const hold = settingNum(ctx.db, 'smoothing_hold_secs');
  for (const ev of ctx.db.signalEvent.memberId.filter(memberId)) {
    const age = secsBetween(ev.ts, ctx.timestamp);
    if (age < after || age > hold * 3) continue;
    if ([...ctx.db.judgment.eventId.filter(ev.id)].length === 0) insertFallbackJudgment(ctx, ev);
  }
}

// ── Focus blocks ──

function closeOpenBlocks(ctx: Ctx, memberId: bigint, at: Timestamp) {
  for (const b of [...ctx.db.focusBlock.memberId.filter(memberId)]) {
    if (b.endedAt !== undefined) continue;
    const end = at.microsSinceUnixEpoch < b.startedAt.microsSinceUnixEpoch ? b.startedAt : at;
    ctx.db.focusBlock.id.update({ ...b, endedAt: end, durationSecs: secsBetween(b.startedAt, end) });
  }
}

function blockKindFor(label: E.StatusLabel): E.FocusBlockKind | undefined {
  switch (label) {
    case 'Focused':
      return 'DeepWork';
    case 'OffTask':
    case 'Away':
      return 'Interruption';
    case 'Break':
      return 'Break';
    default:
      return undefined;
  }
}

function openBlock(ctx: Ctx, s: Session, memberId: bigint, label: E.StatusLabel, reason: E.ReasonCode, at: Timestamp) {
  const kind = blockKindFor(label);
  if (!kind) return;
  ctx.db.focusBlock.insert({
    id: 0n,
    sessionId: s.id,
    memberId,
    kind: tag(kind),
    reasonCode: kind === 'Interruption' ? tag(reason) : undefined,
    startedAt: at,
    endedAt: undefined,
    durationSecs: 0,
    pomodoroCycle: s.cycleNumber,
  });
}

// ── Smoothing ──

type Candidate = { label: E.StatusLabel; reason: E.ReasonCode; confidence: number; since: Timestamp; eventId: bigint };

/**
 * Finds the newest confident label and how long it has held without a
 * contradicting confident label. Low-confidence/Unknown judgments are neutral.
 */
function currentCandidate(ctx: Ctx, memberId: bigint, notBefore: Timestamp | undefined): Candidate | undefined {
  const lowConf = settingNum(ctx.db, 'low_confidence_threshold');
  const window = settingNum(ctx.db, 'smoothing_hold_secs') * 3;
  const judged: Array<{ ts: Timestamp; label: E.StatusLabel; reason: E.ReasonCode; confidence: number; eventId: bigint }> = [];
  for (const j of ctx.db.judgment.memberId.filter(memberId)) {
    if (secsBetween(j.createdAt, ctx.timestamp) > window + 60) continue;
    const ev = ctx.db.signalEvent.id.find(j.eventId);
    if (!ev || secsBetween(ev.ts, ctx.timestamp) > window) continue;
    if (notBefore && ev.ts.microsSinceUnixEpoch < notBefore.microsSinceUnixEpoch) continue;
    if (j.rawLabel.tag === 'Unknown' || j.rawConfidence < lowConf) continue;
    judged.push({ ts: ev.ts, label: j.rawLabel.tag, reason: j.reasonCode.tag, confidence: j.rawConfidence, eventId: ev.id });
  }
  if (judged.length === 0) return undefined;
  judged.sort((a, b) => (a.ts.microsSinceUnixEpoch < b.ts.microsSinceUnixEpoch ? 1 : -1));

  const newest = judged[0];
  let since = newest.ts;
  for (const j of judged) {
    if (j.label !== newest.label) break;
    since = j.ts;
  }
  return { label: newest.label, reason: newest.reason, confidence: newest.confidence, since, eventId: newest.eventId };
}

/** Last group call or nudge triggered for this member. */
function lastInterventionAt(ctx: Ctx, memberId: bigint): Timestamp | undefined {
  return ctx.db.callMemberTrigger.memberId.find(memberId)?.lastTriggeredAt;
}

function transition(ctx: Ctx, s: Session, st: Status, next: Candidate) {
  const prev = st.label.tag;
  closeOpenBlocks(ctx, st.memberId, next.since);
  openBlock(ctx, s, st.memberId, next.label, next.reason, next.since);

  const sc = ctx.db.score.memberId.find(st.memberId);
  if (sc) {
    let updated = { ...sc };
    if (next.label === 'OffTask') updated.interruptionsCount += 1;

    // Quick recovery: back to focus soon after a nudge or call.
    if (next.label === 'Focused' && (prev === 'OffTask' || prev === 'Away')) {
      const window = settingNum(ctx.db, 'quick_recovery_window_secs');
      const intervention = lastInterventionAt(ctx, st.memberId);
      if (
        intervention &&
        intervention.microsSinceUnixEpoch >= st.since.microsSinceUnixEpoch &&
        secsBetween(intervention, next.since) <= window
      ) {
        const bonus = 3;
        updated.recoveryBonusTotal += bonus;
        updated.focusPoints += bonus;
        logScore(ctx, st.memberId, s.id, 'QuickRecovery', bonus, `back on task within ${window}s`);
      }
    }
    ctx.db.score.memberId.update({ ...updated, updatedAt: ctx.timestamp });
  }

  ctx.db.status.memberId.update({
    ...st,
    label: tag(next.label),
    reasonCode: tag(next.reason),
    confidence: next.confidence,
    since: next.since,
    lastEventId: next.eventId,
    smoothedOffTaskSecs: next.label === 'OffTask' ? secsBetween(next.since, ctx.timestamp) : 0,
    updatedAt: ctx.timestamp,
  });
}

/** A confident OffTask label applies immediately so the group learns at once; any other change waits for the `smoothing_hold_secs` hold (avoids flapping back). */
export function applySmoothing(ctx: Ctx, memberId: bigint) {
  const st = ctx.db.status.memberId.find(memberId);
  if (!st) return;
  const s = ctx.db.session.id.find(st.sessionId);
  if (!s || s.state.tag === 'Ended') return;
  const hold = settingNum(ctx.db, 'smoothing_hold_secs');

  if (s.currentPhase.tag === 'Break') {
    if (st.label.tag !== 'Break') {
      transition(ctx, s, st, { label: 'Break', reason: 'Unknown', confidence: 1, since: s.phaseStartedAt ?? ctx.timestamp, eventId: st.lastEventId });
    }
    return;
  }

  // No events at all for a full hold window → the member has stepped away.
  const latestEvent = [...ctx.db.signalEvent.memberId.filter(memberId)].reduce<SignalEvent | undefined>(
    (best, ev) => (!best || ev.ts.microsSinceUnixEpoch > best.ts.microsSinceUnixEpoch ? ev : best),
    undefined
  );
  const lastSeen = latestEvent?.ts ?? s.phaseStartedAt ?? st.since;
  if (secsBetween(lastSeen, ctx.timestamp) >= hold) {
    if (st.label.tag !== 'Away') {
      transition(ctx, s, st, { label: 'Away', reason: 'Left_Seat', confidence: 1, since: lastSeen, eventId: st.lastEventId });
    }
    return;
  }

  const cand = currentCandidate(ctx, memberId, s.phaseStartedAt);
  if (!cand) {
    // Only neutral judgments: keep the current label, just refresh counters.
    ctx.db.status.memberId.update({
      ...st,
      smoothedOffTaskSecs: st.label.tag === 'OffTask' ? secsBetween(st.since, ctx.timestamp) : 0,
      updatedAt: ctx.timestamp,
    });
    return;
  }

  if (cand.label === st.label.tag) {
    ctx.db.status.memberId.update({
      ...st,
      reasonCode: tag(cand.reason),
      confidence: cand.confidence,
      lastEventId: cand.eventId,
      smoothedOffTaskSecs: cand.label === 'OffTask' ? secsBetween(st.since, ctx.timestamp) : 0,
      updatedAt: ctx.timestamp,
    });
  } else if (cand.label === 'OffTask' || secsBetween(cand.since, ctx.timestamp) >= hold) {
    transition(ctx, s, st, cand);
  } else {
    ctx.db.status.memberId.update({
      ...st,
      smoothedOffTaskSecs: st.label.tag === 'OffTask' ? secsBetween(st.since, ctx.timestamp) : 0,
      updatedAt: ctx.timestamp,
    });
  }
}

// ── Scoring ──

function logScore(ctx: Ctx, memberId: bigint, sessionId: bigint, kind: E.ScoreEventKind, delta: number, note: string) {
  ctx.db.scoreEvent.insert({ id: 0n, memberId, sessionId, ts: ctx.timestamp, kind: tag(kind), delta, note });
}

function focusRatioOf(ctx: Ctx, memberId: bigint): number {
  let deep = 0;
  let tracked = 0;
  for (const b of ctx.db.focusBlock.memberId.filter(memberId)) {
    if (b.kind.tag === 'Break') continue;
    const secs = b.endedAt ? b.durationSecs : secsBetween(b.startedAt, ctx.timestamp);
    tracked += secs;
    if (b.kind.tag === 'DeepWork') deep += secs;
  }
  return tracked > 0 ? deep / tracked : 0;
}

export function recomputeGoals(ctx: Ctx, memberId: bigint) {
  const sc = ctx.db.score.memberId.find(memberId);
  if (!sc) return;
  const goals = [...ctx.db.goal.memberId.filter(memberId)];
  const goalsCompleted = goals.filter(g => g.completed).length;
  ctx.db.score.memberId.update({
    ...sc,
    goalsCompleted,
    goalsTotal: goals.length,
    finalScore: sc.focusRatio * goalsCompleted,
    updatedAt: ctx.timestamp,
  });
}

export function logGoalChecked(ctx: Ctx, memberId: bigint, sessionId: bigint, done: boolean, text: string) {
  logScore(ctx, memberId, sessionId, 'GoalChecked', done ? 1 : -1, text);
}

/** Runs every event_interval_secs per member: fallback judging, smoothing, scoring, triggers. */
export function tickScore(ctx: Ctx, memberId: bigint) {
  const m = ctx.db.member.id.find(memberId);
  const s = m ? ctx.db.session.id.find(m.sessionId) : undefined;
  if (!m || !s || m.leftAt !== undefined || s.state.tag === 'Ended') {
    stopTracking(ctx, memberId);
    return;
  }

  fallbackJudgeStale(ctx, memberId);
  applySmoothing(ctx, memberId);

  if (s.state.tag !== 'Active' || s.currentPhase.tag !== 'Work') return;
  const st = ctx.db.status.memberId.find(memberId);
  const sc = ctx.db.score.memberId.find(memberId);
  if (!st || !sc) return;

  const interval = settingNum(ctx.db, 'event_interval_secs');
  const bonusEvery = settingNum(ctx.db, 'streak_bonus_every_secs');
  let updated = { ...sc };

  if (st.label.tag === 'Focused') {
    const tickPoints = interval / 10;
    updated.focusPoints += tickPoints;
    logScore(ctx, memberId, s.id, 'Tick', tickPoints, 'focused');

    const streak = secsBetween(st.since, ctx.timestamp);
    if (bonusEvery > 0 && Math.floor(streak / bonusEvery) > Math.floor(sc.currentStreakSecs / bonusEvery)) {
      const bonus = 5;
      updated.focusPoints += bonus;
      logScore(ctx, memberId, s.id, 'StreakBonus', bonus, `${Math.floor(streak / 60)} min streak`);
    }
    updated.currentStreakSecs = streak;
    updated.bestStreakSecs = Math.max(sc.bestStreakSecs, streak);
  } else {
    updated.currentStreakSecs = 0;
    if (st.label.tag === 'OffTask') {
      const penalty = (interval / 10) * 2;
      updated.focusPoints -= penalty;
      updated.penaltiesTotal += penalty;
      logScore(ctx, memberId, s.id, 'Penalty', -penalty, st.reasonCode.tag);
    }
  }

  updated.focusRatio = focusRatioOf(ctx, memberId);
  updated.finalScore = updated.focusRatio * updated.goalsCompleted;
  ctx.db.score.memberId.update({ ...updated, updatedAt: ctx.timestamp });

  maybeTriggerGroupCall(ctx, memberId);
}

// ── Off-task triggers ──

function offTaskEpisode(ctx: Ctx, memberId: bigint) {
  const m = ctx.db.member.id.find(memberId);
  const s = m ? ctx.db.session.id.find(m.sessionId) : undefined;
  const st = ctx.db.status.memberId.find(memberId);
  if (!m || !s || !st) return undefined;
  if (m.leftAt !== undefined) return undefined;
  if (s.state.tag !== 'Active' || s.currentPhase.tag !== 'Work') return undefined;
  if (st.label.tag !== 'OffTask' || st.smoothedOffTaskSecs < s.offTaskThresholdSecs) return undefined;
  return { m, s, st };
}

export function maybeTriggerGroupCall(ctx: Ctx, memberId: bigint) {
  const ep = offTaskEpisode(ctx, memberId);
  if (!ep) return;
  const { s, st } = ep;
  if (!s.groupCallEnabled) return;

  // One call-or-nudge per off-task episode.
  const trigger = ctx.db.callMemberTrigger.memberId.find(memberId);
  if (trigger && trigger.lastTriggeredAt.microsSinceUnixEpoch >= st.since.microsSinceUnixEpoch) return;

  const calls = [...ctx.db.groupCall.sessionId.filter(s.id)];
  if (calls.some(c => c.state.tag === 'Ringing' || c.state.tag === 'Active')) return;

  if (trigger) {
    ctx.db.callMemberTrigger.memberId.update({ ...trigger, lastTriggeredAt: ctx.timestamp });
  } else {
    ctx.db.callMemberTrigger.insert({ memberId, sessionId: s.id, lastTriggeredAt: ctx.timestamp });
  }

  const cooldown = ctx.db.callCooldown.sessionId.find(s.id);
  const participants = activeMembersOf(ctx.db, s.id);
  const coolingDown = cooldown !== null && cooldown !== undefined && secsBetween(cooldown.lastCallAt, ctx.timestamp) < s.callCooldownSecs;

  if (coolingDown || participants.length < 2) {
    insertAlert(ctx, s.id, memberId, 'NudgeSelf', {
      reasonCode: st.reasonCode.tag,
      offTaskSecs: st.smoothedOffTaskSecs,
      message: 'Drifting a bit? Your group is still locked in.',
    });
    return;
  }

  const maxSecs = Math.min(s.maxCallSecs, settingNum(ctx.db, 'call_max_secs'));
  const roomId = `wyd-${s.code.toLowerCase()}-${calls.length + 1}`;
  const base = settingStr(ctx.db, 'call_room_base_url');
  const call = ctx.db.groupCall.insert({
    id: 0n,
    sessionId: s.id,
    triggeredByMemberId: memberId,
    triggerReasonCode: st.reasonCode,
    roomId,
    roomUrl: base ? base + roomId : undefined,
    state: tag('Ringing'),
    createdAt: ctx.timestamp,
    startedAt: undefined,
    endedAt: undefined,
    maxDurationSecs: maxSecs,
    endedReason: undefined,
  });

  for (const p of participants) {
    ctx.db.callParticipant.insert({ id: 0n, callId: call.id, memberId: p.id, joinedAt: undefined, leftAt: undefined, response: tag('Pending') });
    insertAlert(ctx, s.id, p.id, 'CallIncoming', { callId: call.id, roomId, roomUrl: call.roomUrl, maxDurationSecs: maxSecs });
  }

  if (cooldown) {
    const inHour = secsBetween(cooldown.lastCallAt, ctx.timestamp) < 3600 ? cooldown.callsInLastHour + 1 : 1;
    ctx.db.callCooldown.sessionId.update({ ...cooldown, lastCallAt: ctx.timestamp, callsInLastHour: inHour });
  } else {
    ctx.db.callCooldown.insert({ sessionId: s.id, lastCallAt: ctx.timestamp, callsInLastHour: 1 });
  }

  ctx.db.callTimeoutTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(addSecs(ctx.timestamp, maxSecs).microsSinceUnixEpoch),
    callId: call.id,
  });
}

// ── Calls ──

export function endCall(ctx: Ctx, call: GroupCall, reason: E.CallEndedReason) {
  if (call.state.tag === 'Ended' || call.state.tag === 'Missed') return;
  const parts = [...ctx.db.callParticipant.callId.filter(call.id)];
  const anyJoined = parts.some(p => p.joinedAt !== undefined);
  for (const p of parts) {
    if (p.response.tag === 'Pending') {
      ctx.db.callParticipant.id.update({ ...p, response: tag('Missed') });
    } else if (p.joinedAt !== undefined && p.leftAt === undefined) {
      ctx.db.callParticipant.id.update({ ...p, leftAt: ctx.timestamp });
    }
  }
  const state: E.CallState = !anyJoined && reason === 'Timeout' ? 'Missed' : 'Ended';
  ctx.db.groupCall.id.update({ ...call, state: tag(state), endedAt: ctx.timestamp, endedReason: tag(reason) });
  for (const timer of [...ctx.db.callTimeoutTimer.callId.filter(call.id)]) {
    ctx.db.callTimeoutTimer.scheduledId.delete(timer.scheduledId);
  }
}

// ── End of session ──

export function deleteReplayMeta(ctx: Ctx, sessionId: bigint) {
  for (const clip of [...ctx.db.replayClipMeta.sessionId.filter(sessionId)]) {
    if (clip.deletedAfterSession) ctx.db.replayClipMeta.id.delete(clip.id);
  }
}

function topDistraction(ctx: Ctx, memberId: bigint): E.AppCategory | undefined {
  const counts = new Map<E.AppCategory, number>();
  for (const j of ctx.db.judgment.memberId.filter(memberId)) {
    if (j.rawLabel.tag !== 'OffTask') continue;
    const ev = ctx.db.signalEvent.id.find(j.eventId);
    if (!ev) continue;
    counts.set(ev.appCategory.tag, (counts.get(ev.appCategory.tag) ?? 0) + 1);
  }
  let best: E.AppCategory | undefined;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  return best;
}

/** Closes blocks, writes per-member summaries (text filled later by the worker) and awards. Idempotent. */
export function finalizeSession(ctx: Ctx, s: Session) {
  if ([...ctx.db.sessionSummary.sessionId.filter(s.id)].length > 0) return;
  const endTs = s.endedAt ?? ctx.timestamp;

  for (const m of ctx.db.member.sessionId.filter(s.id)) {
    const memberEnd = m.leftAt ?? endTs;
    closeOpenBlocks(ctx, m.id, memberEnd);

    const blocks = [...ctx.db.focusBlock.memberId.filter(m.id)];
    const deep = blocks.filter(b => b.kind.tag === 'DeepWork');
    const goals = [...ctx.db.goal.memberId.filter(m.id)];
    const start = s.startedAt && s.startedAt.microsSinceUnixEpoch > m.joinedAt.microsSinceUnixEpoch ? s.startedAt : m.joinedAt;
    const top = topDistraction(ctx, m.id);

    ctx.db.sessionSummary.insert({
      id: 0n,
      sessionId: s.id,
      memberId: m.id,
      totalSecs: s.startedAt ? secsBetween(start, memberEnd) : 0,
      deepWorkSecs: deep.reduce((sum, b) => sum + b.durationSecs, 0),
      longestBlockSecs: deep.reduce((max, b) => Math.max(max, b.durationSecs), 0),
      interruptionCount: blocks.filter(b => b.kind.tag === 'Interruption').length,
      topDistractionCategory: top ? tag(top) : undefined,
      goalsCompleted: goals.filter(g => g.completed).length,
      goalsTotal: goals.length,
      summaryText: '',
      notabilityPdfRef: undefined,
      createdAt: ctx.timestamp,
    });

    const sc = ctx.db.score.memberId.find(m.id);
    if (sc && s.startedAt) {
      const started = new Date(Number(s.startedAt.microsSinceUnixEpoch / 1000n));
      ctx.db.focusHistoryIndex.insert({
        id: 0n,
        memberId: m.id,
        sessionId: s.id,
        hourOfDay: started.getUTCHours(),
        dayOfWeek: started.getUTCDay(),
        focusRatio: focusRatioOf(ctx, m.id),
        indexedAt: ctx.timestamp,
      });
    }
  }

  const scores = [...ctx.db.score.sessionId.filter(s.id)];
  const award = (kind: E.AwardKind, pick: (sc: (typeof scores)[number]) => number, note: (v: number) => string) => {
    let best: (typeof scores)[number] | undefined;
    for (const sc of scores) {
      if (pick(sc) <= 0) continue;
      if (!best || pick(sc) > pick(best) || (pick(sc) === pick(best) && sc.focusRatio > best.focusRatio)) best = sc;
    }
    if (best) ctx.db.sessionAward.insert({ id: 0n, sessionId: s.id, memberId: best.memberId, kind: tag(kind), value: pick(best), note: note(pick(best)) });
  };
  award('MVP', sc => sc.finalScore || sc.focusRatio / 100, () => 'Most locked in');
  award('Derailer', sc => sc.interruptionsCount, v => `${v} detours`);
  award('BestRecovery', sc => sc.recoveryBonusTotal, () => 'Fastest bounce-back');
  award('LongestStreak', sc => sc.bestStreakSecs, v => `${Math.floor(v / 60)} min streak`);
}
