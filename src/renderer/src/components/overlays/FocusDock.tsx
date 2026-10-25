import type { MouseEventHandler } from 'react'
import type { Person } from '../../data/people'
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
  judgeOffTask: boolean
  judgeReason: string
  people: Person[]
  checked: boolean[]
  setChecked: (checked: boolean[]) => void
  currentGoal: string
  isTired: boolean
  signalTired: () => void
  takeBreak: () => void
  leaveSession: () => void
  started: boolean
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

export function FocusDock(props: Props) {
  const { hidden, host, serverPhase, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, setTimerRunning, resetPomodoro, selfOffTask, judgeOffTask, judgeReason, people, isTired, signalTired, takeBreak, leaveSession, started, onBreak, breakSeconds, breakMinutes, endBreak, nudge, dismissNudge, tiredNotice, dismissTiredNotice, incoming, checkInTarget, joinCheckIn, onMouseEnter, onMouseLeave } = props
  // During a break the dock counts down the break instead of the focus block.
  const shownSeconds = onBreak ? breakSeconds : focusSeconds
  const totalSeconds = (onBreak ? breakMinutes : pomodoroMinutes) * 60
  return <div className={`focus-dock-wrap ${hidden ? 'dock-hidden' : ''}`}><div className="focus-dock" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}><div className="dock-main"><div className="dock-time"><span className="mini-ring"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle className="mini-progress" cx="12" cy="12" r="9" style={{ strokeDashoffset: 57 * (1 - shownSeconds / totalSeconds) }} /></svg></span><strong>{String(Math.floor(shownSeconds / 60)).padStart(2, '0')}:{String(shownSeconds % 60).padStart(2, '0')}</strong><small>{onBreak ? 'Break' : `R${(pomodorosDone % 4) + 1}/4`}</small></div>{host && !onBreak && serverPhase === 'Lobby' && <div className="dock-pomodoro-controls"><button className="dock-timer-toggle" onClick={() => setTimerRunning(true)} title="Start the session for everyone"><Icon name="arrow" />Start</button></div>}{host && !onBreak && serverPhase === null && <div className="dock-pomodoro-controls"><button className="dock-timer-toggle" onClick={() => setTimerRunning(!timerRunning)} title={timerRunning ? 'Pause Pomodoro' : focusSeconds < pomodoroMinutes * 60 ? 'Resume Pomodoro' : 'Start Pomodoro'}><Icon name={timerRunning ? 'clock' : 'arrow'} />{timerRunning ? 'Pause' : focusSeconds < pomodoroMinutes * 60 ? 'Resume' : 'Start'}</button>{started && <button className="dock-timer-stop" onClick={resetPomodoro} title="Stop and reset Pomodoro"><Icon name="x" /><span>Stop</span></button>}</div>}<span className={`self-status ${judgeOffTask ? 'off-task' : ''}`}><i /><span className="self-status-text">{judgeReason ? `${judgeOffTask ? 'OFF-TASK' : 'ON-TASK'}: ${judgeReason}` : selfOffTask ? 'Off task' : 'On task'}</span></span><div className="dock-people">{people.map((person) => <span key={person.name} className={`avatar dock-avatar ${person.color}`} style={person.hex ? { background: person.hex } : undefined}>{person.initials}<i className={person.status} /></span>)}</div><span className="dock-divider" /><span className="camera-live"><Icon name="camera" /><span>Camera on</span></span></div><div className="dock-detail"><div className="dock-actions">{onBreak ? serverPhase === null ? <button className="break-button" onClick={endBreak}><Icon name="arrow" />Back to focus</button> : <button className="break-button" disabled><Icon name="sparkle" />On break</button> : host ? <button className="break-button" onClick={takeBreak}><Icon name="sparkle" />Take a break</button> : <button className={`tired-button ${isTired ? 'active' : ''}`} onClick={signalTired}><Icon name={isTired ? 'check' : 'clock'} />{isTired ? 'Tired sent' : "I'm tired"}</button>}<button className="leave-session-button" onClick={leaveSession}><Icon name="x" />Leave session</button></div></div></div>
    {nudge && <div className="dock-toast nudge-toast"><span className="list-icon yellow"><Icon name="sparkle" /></span><div><strong>Quick reset?</strong><p>Take a breath and come back to your goal.</p></div><button onClick={dismissNudge} aria-label="Dismiss"><Icon name="x" /></button></div>}
    {tiredNotice && <div className="dock-toast tired-toast"><span className="list-icon yellow"><Icon name="clock" /></span><div><strong>Your host has been notified</strong><p>The timer keeps running. Your host can see that you're ready for a break.</p></div><button onClick={dismissTiredNotice} aria-label="Dismiss"><Icon name="x" /></button></div>}
    {incoming !== null && checkInTarget === 'teammate' && <div className="dock-toast incoming-toast"><span className="list-icon mint"><Icon name="camera" /></span><div><strong>Jake drifted off task</strong><p>Join now, or this check-in will be skipped.</p></div><button className="join-checkin" onClick={joinCheckIn}>Join</button><strong className="incoming-count">{incoming}</strong></div>}
  </div>
}
