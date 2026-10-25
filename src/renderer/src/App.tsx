import { useEffect, useRef, useState } from 'react'
import { EntryScreen } from './components/onboarding/EntryScreen'
import { GoalsScreen } from './components/onboarding/GoalsScreen'
import { IntroductionScreen } from './components/onboarding/IntroductionScreen'
import { BreakScreen } from './components/session/BreakScreen'
import { SessionSidebar } from './components/session/SessionSidebar'
import { SummaryScreen } from './components/session/SummaryScreen'
import type { OverlayState, ToMain, ToOverlay } from './overlay/bridge'
import { Icon } from './components/ui/Icon'
import { people } from './data/people'
import { useDb } from './db/useDb'

type Screen = 'join' | 'consent' | 'goals' | 'focus' | 'break' | 'summary'

export default function App() {
  const [screen, setScreen] = useState<Screen>('join')
  const [entryMode, setEntryMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('')
  const [sessionName, setSessionName] = useState('Chapter Six Study Crew')
  const [codeCopied, setCodeCopied] = useState(false)
  const [goals, setGoals] = useState(['Finish chapter 6 notes', 'Draft chemistry lab intro', ''])
  const [complete, setComplete] = useState(false)
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25)
  const [focusSeconds, setFocusSeconds] = useState(25 * 60)
  const [timerRunning, setTimerRunning] = useState(false)
  const [pomodorosDone, setPomodorosDone] = useState(0)
  const [upcomingBreakMinutes, setUpcomingBreakMinutes] = useState(5)
  const [distraction, setDistraction] = useState('')
  const [savedDistractions, setSavedDistractions] = useState<string[]>([])
  const [checked, setChecked] = useState<boolean[]>([true, false, false])
  const [breakSeconds, setBreakSeconds] = useState(300)
  const [isTired, setIsTired] = useState(false)
  const [tiredNotice, setTiredNotice] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryError, setEntryError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [displayName, setDisplayName] = useState(() => { try { return localStorage.getItem('wyd:name') ?? '' } catch { return '' } })
  const entryStarted = useRef(false)
  const db = useDb()
  const dbSession = db.session
  const isHost = dbSession ? dbSession.isHost : entryMode === 'create'
  const hostName = db.people.find((p) => p.host)?.name ?? 'The host'
  const [checkInCorner, setCheckInCorner] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('top-right')

  useEffect(() => {
    window.wydDesktop?.getPreferences().then((preferences) => {
      if (preferences.checkInCorner) setCheckInCorner(preferences.checkInCorner)
    })
  }, [])


  useEffect(() => {
    if (screen !== 'break') return
    const id = window.setInterval(() => setBreakSeconds((s) => s > 0 ? s - 1 : 0), 1000)
    return () => window.clearInterval(id)
  }, [screen])

  useEffect(() => {
    if (dbSession || screen !== 'focus' || !timerRunning || focusSeconds <= 0) return
    const id = window.setInterval(() => setFocusSeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(id)
  }, [screen, timerRunning, focusSeconds, dbSession])

  useEffect(() => {
    if (!dbSession && timerRunning && focusSeconds === 0) finishPomodoro()
  }, [focusSeconds, timerRunning])

  // Server-driven session: SpacetimeDB owns the clock (phase_started_at + phase length).
  const phaseKey = dbSession ? `${dbSession.state}:${dbSession.phase}:${dbSession.cycle}` : ''
  useEffect(() => {
    if (!dbSession) return
    setSessionName(dbSession.name)
    setCode(dbSession.code)
    setPomodoroMinutes(Math.round(dbSession.workSecs / 60))
    setUpcomingBreakMinutes(Math.round(dbSession.breakSecs / 60))
    if (dbSession.state === 'Lobby') { setFocusSeconds(dbSession.workSecs); setTimerRunning(false) }
  }, [dbSession?.name, dbSession?.code, dbSession?.workSecs, dbSession?.breakSecs, dbSession?.state])

  const serverActive = dbSession?.state === 'Active' || dbSession?.state === 'Break'
  useEffect(() => {
    if (!serverActive) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [serverActive])

  const elapsedSecs = dbSession?.phaseStartedAt ? Math.max(0, Math.floor((now - dbSession.phaseStartedAt) / 1000)) : 0
  useEffect(() => {
    if (dbSession?.state === 'Active') setFocusSeconds(Math.max(0, dbSession.workSecs - elapsedSecs))
  }, [phaseKey, elapsedSecs])

  useEffect(() => {
    if (!dbSession) return
    if (dbSession.state === 'Active') {
      setTimerRunning(true)
      setPomodorosDone(dbSession.cycle - 1)
      setComplete(false)
      setScreen((s) => (s === 'break' ? 'focus' : s))
    } else if (dbSession.state === 'Break') {
      setTimerRunning(false)
      setPomodorosDone(dbSession.cycle)
      setBreakSeconds(Math.max(0, dbSession.breakSecs - Math.floor((Date.now() - (dbSession.phaseStartedAt ?? Date.now())) / 1000)))
      setScreen((s) => { if (s === 'focus') setComplete(true); return s })
    }
  }, [phaseKey])

  const goalsKey = db.myGoals.map((g) => (g.completed ? 1 : 0)).join('')
  useEffect(() => {
    if (dbSession && db.myGoals.length) setChecked(db.myGoals.map((g) => !!g.completed))
  }, [goalsKey, dbSession?.id])




  // Resume after an app restart: the token keeps us a member, so skip the entry screen.
  useEffect(() => {
    if (!dbSession || screen !== 'join' || entryStarted.current) return
    if (db.myName && !displayName) setDisplayName(db.myName)
    if (!db.myGoals.length) return setScreen('goals')
    window.wydDesktop?.startTracking({ subject: dbSession.name, goals: db.myGoals.map((g) => g.text) })
    setScreen(dbSession.state === 'Break' ? 'break' : 'focus')
  }, [dbSession?.id, db.myGoals.length])

  // The host ended the session (or the last person left): everyone still in it goes to the summary.
  useEffect(() => {
    if (db.ended && (screen === 'focus' || screen === 'break' || screen === 'goals')) {
      setComplete(false)
      setTimerRunning(false)
      setScreen('summary')
    }
  }, [db.ended?.sessionId, screen])

  // The dock and check-in windows live in the full-screen overlay window (see overlay/OverlayApp.tsx).
  const [overlayReady, setOverlayReady] = useState(0)
  const handlers = useRef({ signalTired: () => {}, takeBreak: () => {}, leaveSession: () => {}, resetPomodoro: () => {}, setRunning: (_running: boolean) => {}, setChecked: (_checked: boolean[]) => {} })

  useEffect(() => {
    const bridge = window.wydDesktop?.bridge
    if (!bridge) return
    bridge.onMessage((message) => {
      const m = message as ToMain
      if (m.type === 'ready') return setOverlayReady((n) => n + 1)
      if (m.type !== 'action') return
      const a = m.action
      if (a.type === 'setTimerRunning') handlers.current.setRunning(a.running)
      else if (a.type === 'resetPomodoro') handlers.current.resetPomodoro()
      else if (a.type === 'setChecked') handlers.current.setChecked(a.checked)
      else if (a.type === 'signalTired') handlers.current.signalTired()
      else if (a.type === 'dismissTired') setTiredNotice(false)
      else if (a.type === 'takeBreak') handlers.current.takeBreak()
      else if (a.type === 'leave') handlers.current.leaveSession()
    })
    return () => bridge.removeListeners()
  }, [])

  useEffect(() => {
    const visible = screen === 'focus'
    window.wydDesktop?.setOverlayVisible(visible).then(() => { if (visible) window.wydDesktop?.bridge.send({ type: 'reset' }) })
  }, [screen])

  useEffect(() => {
    const state: OverlayState = { host: isHost, serverPhase: dbSession?.state ?? null, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, checked, currentGoal: goals.find((g) => g.trim()) || '', isTired, tiredNotice, checkInCorner }
    window.wydDesktop?.bridge.send({ type: 'state', state })
  }, [overlayReady, isHost, dbSession?.state, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, checked, goals, isTired, tiredNotice, checkInCorner])

  const activeGoals = goals.filter((goal) => goal.trim())
  const finishPomodoro = () => {
    setTimerRunning(false)
    const completed = pomodorosDone + 1
    const breakMinutes = completed % 4 === 0 ? 20 : 5
    setPomodorosDone(completed)
    setUpcomingBreakMinutes(breakMinutes)
    setBreakSeconds(breakMinutes * 60)
    setComplete(true)
  }
  const selectPomodoroLength = (minutes: number) => {
    if (dbSession) {
      if (dbSession.isHost && dbSession.state === 'Lobby') db.call('setPomodoro', { workSecs: minutes * 60, breakSecs: dbSession.breakSecs })
      return
    }
    setPomodoroMinutes(minutes)
    setFocusSeconds(minutes * 60)
    setTimerRunning(false)
  }
  const resetPomodoro = () => {
    if (dbSession) return
    setTimerRunning(false)
    setFocusSeconds(pomodoroMinutes * 60)
  }
  const saveDistraction = () => {
    if (!distraction.trim()) return
    setSavedDistractions([...savedDistractions, distraction.trim()])
    setDistraction('')
  }
  const signalTired = () => {
    setIsTired(true)
    setTiredNotice(true)
    window.setTimeout(() => setTiredNotice(false), 4000)
  }
  const leaveSession = () => {
    if (dbSession) db.call('leaveSession')
    setTimerRunning(false)
    setComplete(false)
    setScreen('summary')
  }
  const sendToOverlay = (message: ToOverlay) => window.wydDesktop?.bridge.send(message)
  const triggerCheckIn = (target: 'me' | 'teammate', scenario: 'none' | 'people' = 'none') => sendToOverlay({ type: 'checkIn', target, scenario })
  const setRunning = (running: boolean) => {
    if (dbSession) {
      if (running && dbSession.isHost && dbSession.state === 'Lobby') db.call('startSession')
      return
    }
    setTimerRunning(running)
  }
  const updateChecked = (next: boolean[]) => {
    setChecked(next)
    if (!dbSession) return
    next.forEach((done, i) => {
      const goal = db.myGoals[i]
      if (goal && !!goal.completed !== done) db.call('checkGoal', { goalId: BigInt(goal.id), done })
    })
  }
  const endSession = () => {
    if (dbSession?.isHost) db.call('endSession')
    else if (dbSession) leaveSession()
    else setScreen('summary')
  }
  const takeBreak = () => {
    if (dbSession) { if (dbSession.isHost && dbSession.state === 'Active') db.call('takeBreak'); return }
    setTimerRunning(false)
    setScreen('break')
  }
  const beginSessionSetup = async () => {
    if (db.snapshot.connected) {
      entryStarted.current = true
      setEntryError('')
      setEntryBusy(true)
      const name = displayName.trim()
      if (name) {
        try { localStorage.setItem('wyd:name', name) } catch { /* optional */ }
        const nameError = await db.call('setProfile', { displayName: name, avatarColor: '#7C8CF8' })
        if (nameError) { setEntryBusy(false); return setEntryError(nameError) }
      }
      const unset = { pomodoroWorkSecs: undefined, pomodoroBreakSecs: undefined, offTaskThresholdSecs: undefined, callCooldownSecs: undefined, maxCallSecs: undefined, scoreboardEnabled: undefined, groupCallEnabled: undefined, topicDescription: undefined, allowedDomains: undefined, blockedDomains: undefined }
      const error = entryMode === 'create' ? await db.call('createSession', { name: sessionName.trim(), settings: unset }) : await db.call('joinSession', { code: code.trim() })
      setEntryBusy(false)
      if (error) return setEntryError(error)
    }
    try {
      setScreen(localStorage.getItem('wyd:tutorial-complete') === 'true' ? 'goals' : 'consent')
    } catch {
      setScreen('consent')
    }
  }
  const finishTutorial = () => {
    try {
      localStorage.setItem('wyd:tutorial-complete', 'true')
    } catch {
      // The tutorial still works when storage is unavailable.
    }
    setScreen('goals')
  }
  handlers.current = { signalTired, takeBreak, leaveSession, resetPomodoro, setRunning, setChecked: updateChecked }

  if (screen === 'join') return <EntryScreen error={entryError} busy={entryBusy} mode={entryMode} setMode={setEntryMode} code={entryMode === 'create' && !dbSession ? '······' : code} setCode={setCode} sessionName={sessionName} setSessionName={setSessionName} codeCopied={codeCopied} copyCode={() => { navigator.clipboard?.writeText(code); setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1600) }} continueSetup={beginSessionSetup} displayName={displayName} setDisplayName={setDisplayName} />

  if (screen === 'consent') return <IntroductionScreen onComplete={finishTutorial} />

  if (screen === 'goals') return <GoalsScreen goals={goals} setGoals={setGoals} onStart={async () => { if (dbSession) { const error = await db.call('setGoals', { goals: activeGoals }); if (error) return window.alert(error) }; window.wydDesktop?.startTracking({ subject: sessionName, goals: activeGoals }); if (!dbSession && entryMode === 'join') setTimerRunning(true); setScreen('focus') }} />

  if (screen === 'break') return <BreakScreen minutes={upcomingBreakMinutes} seconds={breakSeconds} goals={activeGoals} checked={checked} setChecked={updateChecked} onReturn={() => { setBreakSeconds(upcomingBreakMinutes * 60); setFocusSeconds(pomodoroMinutes * 60); setIsTired(false); setScreen('focus') }} />

  if (screen === 'summary') return <SummaryScreen checked={checked} goalCount={activeGoals.length} stats={db.ended} />

  return <main className="focus-page">
    <div className="demo-menu">
      <button className="demo-trigger" onClick={() => setDemoOpen(!demoOpen)}>Demo <Icon name="arrow" /></button>
      {demoOpen && <div className="demo-popover"><span>Prototype controls</span><button onClick={() => { triggerCheckIn('me', 'none'); setDemoOpen(false) }}>I go off task · no one joins</button><button onClick={() => { triggerCheckIn('me', 'people'); setDemoOpen(false) }}>I go off task · people join</button><button onClick={() => { triggerCheckIn('teammate'); setDemoOpen(false) }}>Teammate goes off task</button><div className="corner-setting"><small>Check-in corner</small><div>{(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => <button className={checkInCorner === corner ? 'active' : ''} key={corner} onClick={() => { setCheckInCorner(corner); window.wydDesktop?.setPreferences({ checkInCorner: corner }) }} aria-label={corner}>{corner.split('-').map((part) => part[0].toUpperCase()).join('')}</button>)}</div></div>{isHost && <button onClick={() => { finishPomodoro(); setDemoOpen(false) }}>Finish Pomodoro</button>}<button onClick={endSession}>{dbSession && !isHost ? 'Leave session' : 'End session'}</button></div>}
    </div>
    <section className="focus-grid">
      <div className="timer-panel"><div className="eyebrow">Focus session · Round {(pomodorosDone % 4) + 1} of 4</div><div className="pomodoro-rounds">{[0, 1, 2, 3].map((round) => <span className={round < pomodorosDone % 4 ? 'done' : round === pomodorosDone % 4 ? 'current' : ''} key={round}><Icon name="check" /></span>)}</div><div className="timer-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" /><circle className="timer-progress" cx="90" cy="90" r="80" style={{ strokeDashoffset: 502 * (1 - focusSeconds / (pomodoroMinutes * 60)) }} /></svg><div><strong>{String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:{String(focusSeconds % 60).padStart(2, '0')}</strong><span>{timerRunning ? 'focus time' : focusSeconds === pomodoroMinutes * 60 ? isHost ? 'ready when you are' : 'waiting for host' : 'paused by host'}</span></div></div><h2>{timerRunning ? 'Stay with it.' : isHost ? 'Choose one task.' : 'Your host sets the pace.'}</h2>{dbSession?.state === 'Lobby' && <p className="lobby-line">Invite code <strong>{dbSession.code}</strong> · {db.people.length} in the room</p>}<p>{activeGoals[0] || 'Pick something that deserves your full attention.'}</p>{isHost ? <div className="pomodoro-console host-console"><div className="console-role"><span className="host-control-badge"><Icon name="users" />Host controls</span><small>Everyone’s timer stays in sync with yours.</small></div><div className="time-select"><span>Focus length</span>{[15, 25, 45].map((minutes) => <button className={pomodoroMinutes === minutes ? 'active' : ''} onClick={() => selectPomodoroLength(minutes)} key={minutes}>{minutes} min</button>)}</div><div className="timer-controls"><button className="timer-stop" disabled={!!dbSession && dbSession.state !== 'Active'} onClick={() => dbSession ? takeBreak() : resetPomodoro()}><Icon name={dbSession ? 'clock' : 'x'} />{dbSession ? 'Take a break' : 'Stop'}</button><button className="timer-start" disabled={!!dbSession && dbSession.state !== 'Lobby'} onClick={() => dbSession ? setRunning(true) : setTimerRunning(!timerRunning)}><Icon name={timerRunning ? 'clock' : 'arrow'} />{dbSession ? (dbSession.state === 'Lobby' ? 'Start session' : 'Session running') : timerRunning ? 'Pause for everyone' : focusSeconds < pomodoroMinutes * 60 ? 'Resume session' : 'Start session'}</button></div>{dbSession && dbSession.state !== 'Lobby' && <button className="timer-stop" onClick={endSession}><Icon name="x" />End session for everyone</button>}<div className="focus-oath"><Icon name="target" /><span><strong>My focus promise</strong>I’ll give this task my full attention until the timer rings.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div> : <div className="pomodoro-console participant-console"><div className="participant-host"><span className="avatar bg-[#dbe9ff]">MK<i /></span><div><small>Session host</small><strong>{hostName} controls this Pomodoro</strong><p>You’ll start, pause, and take breaks together.</p></div><span className="sync-status"><i />Synced</span></div><div className="participant-schedule"><span><small>Focus</small><strong>{pomodoroMinutes} min</strong></span><Icon name="arrow" /><span><small>Short break</small><strong>5 min</strong></span><Icon name="arrow" /><span><small>After 4 rounds</small><strong>20 min</strong></span></div><div className="focus-oath"><Icon name="lock" /><span><strong>Timer controls are host-only</strong>Your timer updates automatically when {hostName} starts the session.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div>}</div>
      <SessionSidebar sessionName={sessionName} role={isHost ? 'Host' : 'Participant'} goals={activeGoals} checked={checked} setChecked={updateChecked} people={dbSession ? db.people.filter((p) => !p.me) : people} />
    </section>
    {complete && <div className="overlay"><div className="complete-modal"><div className="icon-bubble mint"><Icon name="check" /></div><div className="eyebrow">{pomodoroMinutes} minutes complete</div><h2>Pomodoro complete.</h2><p>{upcomingBreakMinutes >= 20 ? 'That’s four rounds. Take a longer 20-minute break so your brain can recharge.' : 'Mark it complete and take a five-minute break before the next round.'}</p><div className="button-row"><button className="secondary" onClick={() => { setComplete(false); endSession() }}>{dbSession && !isHost ? 'Leave session' : 'End session'}</button><button className="primary" onClick={() => { setComplete(false); setScreen('break') }}>Take {upcomingBreakMinutes} min break <Icon name="arrow" /></button></div></div></div>}
  </main>
}
