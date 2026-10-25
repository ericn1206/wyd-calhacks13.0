import type { MouseEventHandler } from 'react'
import type { Person } from '../../data/people'
import type { DetectorDebug } from '../../../../main/facetimeTrigger'
import { Icon } from '../ui/Icon'

type Props = {
  hidden: boolean
  host: boolean
  serverPhase: string | null
  focusSeconds: number
  pomodoroMinutes: number
  pomodorosDone: number
  timerRunning: boolean
  setTimerRunning: (running: boolean) => void
  resetPomodoro: () => void
  selfOffTask: boolean
  people: Person[]
  checked: boolean[]
  setChecked: (checked: boolean[]) => void
  currentGoal: string
  isTired: boolean
  signalTired: () => void
  takeBreak: () => void
  leaveSession: () => void
  started: boolean
  currentActivity: string
  tracking: boolean
  statusReason: string
  statusReasonOff: boolean
  debugEnabled: boolean
  debug: DetectorDebug | null
  liveInvite: { name: string; seconds: number } | null
  joinLiveInvite: () => void
  onBreak: boolean
  breakSeconds: number
  breakMinutes: number
  endBreak: () => void
  nudge: boolean
  dismissNudge: () => void
  tiredNotice: boolean
  dismissTiredNotice: () => void
  incoming: number | null
  checkInTarget: 'me' | 'teammate' | null
  joinCheckIn: () => void
  onMouseEnter: MouseEventHandler<HTMLDivElement>
  onMouseLeave: MouseEventHandler<HTMLDivElement>
}

/** Demo-menu debug strip: the detector's latest verdict, with the screen (OCR → Gemini) and webcam results shown separately. */
function DockDebug({ debug, currentActivity }: { debug: DetectorDebug | null; currentActivity: string }) {
  if (!debug) return <div className="dock-debug"><span className="debug-chip">Debug · waiting for the first detector check…</span></div>
  const verdict = debug.status === 'off' ? 'Off task' : debug.status === 'on' ? 'On task' : 'No verdict'
  const screen = debug.screen === 'off' ? 'off task' : debug.screen === 'ok' ? 'on task' : 'unknown'
  const webcam = debug.webcam === 'none' ? 'no data' : `${debug.webcam} · p=${debug.prob.toFixed(2)}${debug.face ? '' : ' · no face'}`
  return <div className="dock-debug">
    <span className={`debug-chip verdict ${debug.status}`}>{verdict}</span>
    <span className="debug-chip" title={debug.reason}><b>OCR</b> {screen} · {debug.reason || '—'} ({debug.ocrChars} chars)</span>
    <span className="debug-chip"><b>Webcam</b> {webcam}</span>
    <span className="debug-chip"><b>Streak</b> {debug.screenStreak}/{debug.camStreak}</span>
    {currentActivity && <span className="debug-chip"><b>App</b> {currentActivity}</span>}
  </div>
}

export function FocusDock(props: Props) {
  const { hidden, host, serverPhase, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, setTimerRunning, resetPomodoro, selfOffTask, people, checked, setChecked, currentGoal, isTired, signalTired, takeBreak, leaveSession, started, currentActivity, tracking, statusReason, statusReasonOff, debugEnabled, debug, liveInvite, joinLiveInvite, onBreak, breakSeconds, breakMinutes, endBreak, nudge, dismissNudge, tiredNotice, dismissTiredNotice, incoming, checkInTarget, joinCheckIn, onMouseEnter, onMouseLeave } = props
  // During a break the dock counts down the break instead of the focus block.
  const shownSeconds = onBreak ? breakSeconds : focusSeconds
  const totalSeconds = (onBreak ? breakMinutes : pomodoroMinutes) * 60
  const statusText = !tracking ? 'Idle'
    : statusReason && statusReasonOff === selfOffTask ? `${selfOffTask ? 'OFF-TASK' : 'ON-TASK'}: ${statusReason}`
    : selfOffTask ? 'Off task' : 'On task'
  return <div className={`focus-dock-wrap ${hidden ? 'dock-hidden' : ''}`}><div className="focus-dock" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}><div className="dock-main"><div className="dock-time"><span className="mini-ring"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle className="mini-progress" cx="12" cy="12" r="9" style={{ strokeDashoffset: 57 * (1 - shownSeconds / totalSeconds) }} /></svg></span><strong>{String(Math.floor(shownSeconds / 60)).padStart(2, '0')}:{String(shownSeconds % 60).padStart(2, '0')}</strong><small>{onBreak ? 'Break' : `R${(pomodorosDone % 4) + 1}/4`}</small></div>{host && !onBreak && serverPhase === 'Lobby' && <div className="dock-pomodoro-controls"><button className="dock-timer-toggle" onClick={() => setTimerRunning(true)} title="Start the session for everyone"><Icon name="arrow" />Start</button></div>}{host && !onBreak && serverPhase === null && <div className="dock-pomodoro-controls"><button className="dock-timer-toggle" onClick={() => setTimerRunning(!timerRunning)} title={timerRunning ? 'Pause Pomodoro' : focusSeconds < pomodoroMinutes * 60 ? 'Resume Pomodoro' : 'Start Pomodoro'}><Icon name={timerRunning ? 'clock' : 'arrow'} />{timerRunning ? 'Pause' : focusSeconds < pomodoroMinutes * 60 ? 'Resume' : 'Start'}</button>{started && <button className="dock-timer-stop" onClick={resetPomodoro} title="Stop and reset Pomodoro"><Icon name="x" /><span>Stop</span></button>}</div>}<span className={`self-status ${!tracking ? 'idle' : selfOffTask ? 'off-task' : ''}`} title={statusText}><i /><span className="self-status-text">{statusText}</span></span><div className="dock-people">{people.map((person) => <span key={person.name} className={`avatar dock-avatar ${person.color}`} style={person.hex ? { background: person.hex } : undefined}>{person.initials}<i className={person.status} /></span>)}</div><span className="dock-divider" /><span className={`camera-live ${tracking ? '' : 'off'}`}><Icon name="camera" /><span>{tracking ? 'Camera on' : 'Camera off'}</span></span></div><div className="dock-detail"><div className="dock-actions">{onBreak ? serverPhase === null ? <button className="break-button" onClick={endBreak}><Icon name="arrow" />Back to focus</button> : <button className="break-button" disabled><Icon name="sparkle" />On break</button> : host ? <button className="break-button" onClick={takeBreak}><Icon name="sparkle" />Take a break</button> : <button className={`tired-button ${isTired ? 'active' : ''}`} onClick={signalTired}><Icon name={isTired ? 'check' : 'clock'} />{isTired ? 'Tired sent' : 'I’m tired'}</button>}<button className="leave-session-button" onClick={leaveSession}><Icon name="x" />Leave session</button></div></div></div>{debugEnabled && <DockDebug debug={debug} currentActivity={currentActivity} />}
    {liveInvite && <div className="dock-toast incoming-toast"><span className="list-icon mint"><Icon name="camera" /></span><div><strong>{liveInvite.name} drifted off task</strong><p>Join the check-in, or it's skipped.</p></div><button className="join-checkin" onClick={joinLiveInvite}>Join</button><strong className="incoming-count">{liveInvite.seconds}</strong></div>}
    {nudge && <div className="dock-toast nudge-toast"><span className="list-icon yellow"><Icon name="sparkle" /></span><div><strong>Quick reset?</strong><p>Take a breath and come back to your goal.</p></div><button onClick={dismissNudge} aria-label="Dismiss"><Icon name="x" /></button></div>}
    {tiredNotice && <div className="dock-toast tired-toast"><span className="list-icon yellow"><Icon name="clock" /></span><div><strong>Your host has been notified</strong><p>The timer keeps running. Your host can see that you’re ready for a break.</p></div><button onClick={dismissTiredNotice} aria-label="Dismiss"><Icon name="x" /></button></div>}
    {incoming !== null && checkInTarget === 'teammate' && <div className="dock-toast incoming-toast"><span className="list-icon mint"><Icon name="camera" /></span><div><strong>Jake drifted off task</strong><p>Join now, or this check-in will be skipped.</p></div><button className="join-checkin" onClick={joinCheckIn}>Join</button><strong className="incoming-count">{incoming}</strong></div>}
  </div>
}
