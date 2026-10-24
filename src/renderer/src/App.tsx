import { useEffect, useMemo, useRef, useState } from 'react'
import { EntryScreen } from './components/onboarding/EntryScreen'
import { GoalsScreen } from './components/onboarding/GoalsScreen'
import { IntroductionScreen } from './components/onboarding/IntroductionScreen'
import { BreakScreen } from './components/session/BreakScreen'
import { LiveBanner, LiveGrid } from './components/session/LiveGrid'
import { SessionSidebar } from './components/session/SessionSidebar'
import { SummaryScreen } from './components/session/SummaryScreen'
import type { OverlayState, ToMain, ToOverlay } from './overlay/bridge'
import { Icon } from './components/ui/Icon'
import { people } from './data/people'
import { useCircleCall } from './useCircleCall'

type Screen = 'join' | 'consent' | 'goals' | 'focus' | 'break' | 'summary'

export default function App() {
  const [screen, setScreen] = useState<Screen>('join')
  const [entryMode, setEntryMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('STUDY25')
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
  const [checkInCorner, setCheckInCorner] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('top-right')

  useEffect(() => {
    window.wydDesktop?.getPreferences().then((preferences) => {
      if (preferences.checkInCorner) setCheckInCorner(preferences.checkInCorner)
    })
  }, [])

  // Demo live view (LOCKIN_DEMO=1): LiveKit room per session code + webcam detector badge.
  const [profile, setProfile] = useState({ demo: false, name: 'Friend' })
  const [cameraFocus, setCameraFocus] = useState('off')
  const [liveGridHidden, setLiveGridHidden] = useState(false)
  useEffect(() => {
    window.circleAPI?.getProfile().then(setProfile).catch(() => undefined)
    window.wydDesktop?.onActivityUpdate((state) => setCameraFocus(state.vision?.focus ?? 'off'))
    return () => window.wydDesktop?.removeActivityListeners()
  }, [])
  const inSession = screen === 'focus' || screen === 'break'
  const circleRoom = useMemo(
    () => (profile.demo && inSession && code.trim() ? { name: profile.name, sessionCode: code } : null),
    [profile.demo, profile.name, inSession, code]
  )
  const circle = useCircleCall(circleRoom, { focus: cameraFocus, allowLiveView: profile.demo })


  useEffect(() => {
    if (screen !== 'break') return
    const id = window.setInterval(() => setBreakSeconds((s) => s > 0 ? s - 1 : 0), 1000)
    return () => window.clearInterval(id)
  }, [screen])

  useEffect(() => {
    if (screen !== 'focus' || !timerRunning || focusSeconds <= 0) return
    const id = window.setInterval(() => setFocusSeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(id)
  }, [screen, timerRunning, focusSeconds])

  useEffect(() => {
    if (timerRunning && focusSeconds === 0) finishPomodoro()
  }, [focusSeconds, timerRunning])



  // The dock and check-in windows live in the full-screen overlay window (see overlay/OverlayApp.tsx).
  const [overlayReady, setOverlayReady] = useState(0)
  const handlers = useRef({ signalTired: () => {}, takeBreak: () => {}, leaveSession: () => {}, resetPomodoro: () => {} })

  useEffect(() => {
    const bridge = window.wydDesktop?.bridge
    if (!bridge) return
    bridge.onMessage((message) => {
      const m = message as ToMain
      if (m.type === 'ready') return setOverlayReady((n) => n + 1)
      if (m.type !== 'action') return
      const a = m.action
      if (a.type === 'setTimerRunning') setTimerRunning(a.running)
      else if (a.type === 'resetPomodoro') handlers.current.resetPomodoro()
      else if (a.type === 'setChecked') setChecked(a.checked)
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
    const state: OverlayState = { host: entryMode === 'create', focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, checked, currentGoal: goals.find((g) => g.trim()) || '', isTired, tiredNotice, checkInCorner }
    window.wydDesktop?.bridge.send({ type: 'state', state })
  }, [overlayReady, entryMode, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, checked, goals, isTired, tiredNotice, checkInCorner])

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
    setPomodoroMinutes(minutes)
    setFocusSeconds(minutes * 60)
    setTimerRunning(false)
  }
  const resetPomodoro = () => {
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
    setTimerRunning(false)
    setComplete(false)
    setScreen('summary')
  }
  const sendToOverlay = (message: ToOverlay) => window.wydDesktop?.bridge.send(message)
  const triggerCheckIn = (target: 'me' | 'teammate', scenario: 'none' | 'people' = 'none') => sendToOverlay({ type: 'checkIn', target, scenario })
  const beginSessionSetup = () => {
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
  handlers.current = { signalTired, takeBreak: () => { setTimerRunning(false); setScreen('break') }, leaveSession, resetPomodoro }

  if (screen === 'join') return <EntryScreen mode={entryMode} setMode={setEntryMode} code={code} setCode={setCode} sessionName={sessionName} setSessionName={setSessionName} codeCopied={codeCopied} copyCode={() => { navigator.clipboard?.writeText(code); setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1600) }} continueSetup={beginSessionSetup} />

  if (screen === 'consent') return <IntroductionScreen onComplete={finishTutorial} />

  if (screen === 'goals') return <GoalsScreen goals={goals} setGoals={setGoals} onStart={() => { window.wydDesktop?.startTracking({ subject: sessionName, goals: activeGoals }); if (entryMode === 'join') setTimerRunning(true); setScreen('focus') }} />

  const liveLayer = circle.liveView && <>
    <LiveBanner gridHidden={liveGridHidden} onShow={() => setLiveGridHidden(false)} />
    {!liveGridHidden && <LiveGrid localName={profile.name} localStream={circle.localStream} localFocus={cameraFocus} remotes={circle.remotes} error={circle.error} onHide={() => setLiveGridHidden(true)} onTurnOff={() => circle.setLiveView(false)} />}
  </>

  if (screen === 'break') return <>{liveLayer}<BreakScreen minutes={upcomingBreakMinutes} seconds={breakSeconds} goals={activeGoals} checked={checked} setChecked={setChecked} onReturn={() => { setBreakSeconds(upcomingBreakMinutes * 60); setFocusSeconds(pomodoroMinutes * 60); setIsTired(false); setScreen('focus') }} /></>

  if (screen === 'summary') return <SummaryScreen checked={checked} goalCount={activeGoals.length} />

  return <main className="focus-page">
    <div className="demo-menu">
      <button className="demo-trigger" onClick={() => setDemoOpen(!demoOpen)}>Demo <Icon name="arrow" /></button>
      {demoOpen && <div className="demo-popover"><span>Prototype controls</span><button onClick={() => { triggerCheckIn('me', 'none'); setDemoOpen(false) }}>I go off task · no one joins</button><button onClick={() => { triggerCheckIn('me', 'people'); setDemoOpen(false) }}>I go off task · people join</button><button onClick={() => { triggerCheckIn('teammate'); setDemoOpen(false) }}>Teammate goes off task</button><div className="corner-setting"><small>Check-in corner</small><div>{(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => <button className={checkInCorner === corner ? 'active' : ''} key={corner} onClick={() => { setCheckInCorner(corner); window.wydDesktop?.setPreferences({ checkInCorner: corner }) }} aria-label={corner}>{corner.split('-').map((part) => part[0].toUpperCase()).join('')}</button>)}</div></div>{entryMode === 'create' && <button onClick={() => { finishPomodoro(); setDemoOpen(false) }}>Finish Pomodoro</button>}{profile.demo && <button disabled={circle.status !== 'connected'} onClick={() => { circle.setLiveView(!circle.liveView); setLiveGridHidden(false); setDemoOpen(false) }}>{circle.liveView ? 'Turn off live camera view' : circle.status === 'connected' ? 'Live camera view · everyone' : 'Live camera view (connecting…)'}</button>}<button onClick={() => setScreen('summary')}>End session</button></div>}
    </div>
    <section className="focus-grid">
      <div className="timer-panel"><div className="eyebrow">Focus session · Round {(pomodorosDone % 4) + 1} of 4</div><div className="pomodoro-rounds">{[0, 1, 2, 3].map((round) => <span className={round < pomodorosDone % 4 ? 'done' : round === pomodorosDone % 4 ? 'current' : ''} key={round}><Icon name="check" /></span>)}</div><div className="timer-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" /><circle className="timer-progress" cx="90" cy="90" r="80" style={{ strokeDashoffset: 502 * (1 - focusSeconds / (pomodoroMinutes * 60)) }} /></svg><div><strong>{String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:{String(focusSeconds % 60).padStart(2, '0')}</strong><span>{timerRunning ? 'focus time' : focusSeconds === pomodoroMinutes * 60 ? entryMode === 'create' ? 'ready when you are' : 'waiting for host' : 'paused by host'}</span></div></div><h2>{timerRunning ? 'Stay with it.' : entryMode === 'create' ? 'Choose one task.' : 'Your host sets the pace.'}</h2><p>{activeGoals[0] || 'Pick something that deserves your full attention.'}</p>{entryMode === 'create' ? <div className="pomodoro-console host-console"><div className="console-role"><span className="host-control-badge"><Icon name="users" />Host controls</span><small>Everyone’s timer stays in sync with yours.</small></div><div className="time-select"><span>Focus length</span>{[15, 25, 45].map((minutes) => <button className={pomodoroMinutes === minutes ? 'active' : ''} onClick={() => selectPomodoroLength(minutes)} key={minutes}>{minutes} min</button>)}</div><div className="timer-controls"><button className="timer-stop" onClick={resetPomodoro}><Icon name="x" />Stop</button><button className="timer-start" onClick={() => setTimerRunning(!timerRunning)}><Icon name={timerRunning ? 'clock' : 'arrow'} />{timerRunning ? 'Pause for everyone' : focusSeconds < pomodoroMinutes * 60 ? 'Resume session' : 'Start session'}</button></div><div className="focus-oath"><Icon name="target" /><span><strong>My focus promise</strong>I’ll give this task my full attention until the timer rings.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div> : <div className="pomodoro-console participant-console"><div className="participant-host"><span className="avatar bg-[#dbe9ff]">MK<i /></span><div><small>Session host</small><strong>Maya controls this Pomodoro</strong><p>You’ll start, pause, and take breaks together.</p></div><span className="sync-status"><i />Synced</span></div><div className="participant-schedule"><span><small>Focus</small><strong>{pomodoroMinutes} min</strong></span><Icon name="arrow" /><span><small>Short break</small><strong>5 min</strong></span><Icon name="arrow" /><span><small>After 4 rounds</small><strong>20 min</strong></span></div><div className="focus-oath"><Icon name="lock" /><span><strong>Timer controls are host-only</strong>Your timer updates automatically when Maya starts, pauses, or stops the session.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div>}</div>
      <SessionSidebar sessionName={sessionName} role={entryMode === 'create' ? 'Host' : 'Participant'} goals={activeGoals} checked={checked} setChecked={setChecked} people={people} />
    </section>
    {complete && <div className="overlay"><div className="complete-modal"><div className="icon-bubble mint"><Icon name="check" /></div><div className="eyebrow">{pomodoroMinutes} minutes complete</div><h2>Pomodoro complete.</h2><p>{upcomingBreakMinutes >= 20 ? 'That’s four rounds. Take a longer 20-minute break so your brain can recharge.' : 'Mark it complete and take a five-minute break before the next round.'}</p><div className="button-row"><button className="secondary" onClick={() => { setComplete(false); setScreen('summary') }}>End session</button><button className="primary" onClick={() => { setComplete(false); setScreen('break') }}>Take {upcomingBreakMinutes} min break <Icon name="arrow" /></button></div></div></div>}
    {liveLayer}
  </main>
}
