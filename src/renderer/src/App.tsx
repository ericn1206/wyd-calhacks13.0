import { useEffect, useRef, useState } from 'react'
import { EntryScreen } from './components/onboarding/EntryScreen'
import { GoalsScreen } from './components/onboarding/GoalsScreen'
import { IntroductionScreen } from './components/onboarding/IntroductionScreen'
import { DesktopPreview } from './components/session/DesktopPreview'
import { BreakScreen } from './components/session/BreakScreen'
import { SessionSidebar } from './components/session/SessionSidebar'
import { SummaryScreen } from './components/session/SummaryScreen'
import { FocusDock } from './components/overlays/FocusDock'
import { Icon } from './components/ui/Icon'
import { people } from './data/people'

type Screen = 'join' | 'consent' | 'goals' | 'focus' | 'break' | 'summary'

export default function App() {
  const [screen, setScreen] = useState<Screen>('join')
  const [entryMode, setEntryMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('STUDY25')
  const [sessionName, setSessionName] = useState('Chapter Six Study Crew')
  const [codeCopied, setCodeCopied] = useState(false)
  const [goals, setGoals] = useState(['Finish chapter 6 notes', 'Draft chemistry lab intro', ''])
  const [callOpen, setCallOpen] = useState(false)
  const [callSeconds, setCallSeconds] = useState(30)
  const [lastCall, setLastCall] = useState<number | null>(null)
  const [nudge, setNudge] = useState(false)
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
  const [dockHidden, setDockHidden] = useState(true)
  const [isTired, setIsTired] = useState(false)
  const [tiredNotice, setTiredNotice] = useState(false)
  const [selfOffTask, setSelfOffTask] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [desktopPreview, setDesktopPreview] = useState(false)
  const [incoming, setIncoming] = useState<number | null>(null)
  const [checkInTarget, setCheckInTarget] = useState<'me' | 'teammate' | null>(null)
  const [returnPrompt, setReturnPrompt] = useState(false)
  const [checkInCorner, setCheckInCorner] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('top-right')
  const [selfJoinScenario, setSelfJoinScenario] = useState<'none' | 'people'>('none')
  const [visibleVideos, setVisibleVideos] = useState(1)
  const [closedVideos, setClosedVideos] = useState<Set<string>>(new Set())
  const [teammateWindowOffset, setTeammateWindowOffset] = useState({ x: 0, y: 0 })
  const hideTimer = useRef<number | null>(null)
  const dockHovered = useRef(false)
  const dockPinned = useRef(false)
  const teammateWindowDrag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)

  useEffect(() => {
    window.wydDesktop?.getPreferences().then((preferences) => {
      if (preferences.checkInCorner) setCheckInCorner(preferences.checkInCorner)
    })
  }, [])

  useEffect(() => {
    if (!callOpen) return
    const id = window.setInterval(() => setCallSeconds((s) => {
      if (s <= 1) {
        window.clearInterval(id)
        setCallOpen(false)
        setLastCall(Date.now())
        dockPinned.current = false
        hideTimer.current = window.setTimeout(() => {
          if (!dockHovered.current) setDockHidden(true)
          hideTimer.current = null
        }, 600)
        if (checkInTarget === 'me') setReturnPrompt(true)
        else setCheckInTarget(null)
        return 30
      }
      return s - 1
    }), 1000)
    return () => window.clearInterval(id)
  }, [callOpen, checkInTarget])

  useEffect(() => {
    if (!callOpen) return
    dockPinned.current = true
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
    setDockHidden(false)
    setVisibleVideos(1)
    setClosedVideos(new Set())
    setTeammateWindowOffset({ x: 0, y: 0 })
    const totalVideos = checkInTarget === 'teammate' || selfJoinScenario === 'none' ? 1 : 3
    const joinTimers = Array.from({ length: totalVideos - 1 }, (_, index) => window.setTimeout(() => setVisibleVideos(index + 2), (index + 1) * 650))
    try {
      const audio = new AudioContext()
      const gain = audio.createGain()
      const oscillator = audio.createOscillator()
      oscillator.frequency.setValueAtTime(620, audio.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(820, audio.currentTime + .18)
      gain.gain.setValueAtTime(.025, audio.currentTime)
      gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .3)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start()
      oscillator.stop(audio.currentTime + .3)
    } catch {
      // Browsers may block audio outside a direct interaction.
    }
    return () => joinTimers.forEach(window.clearTimeout)
  }, [callOpen, checkInTarget, selfJoinScenario])

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

  useEffect(() => {
    if (screen !== 'focus') return
    const scheduleHide = () => {
      if (dockPinned.current) return
      if (hideTimer.current) return
      hideTimer.current = window.setTimeout(() => {
        if (!dockHovered.current) setDockHidden(true)
        hideTimer.current = null
      }, 600)
    }
    const onMove = (event: MouseEvent) => {
      if (event.clientY <= 40) {
        if (hideTimer.current) window.clearTimeout(hideTimer.current)
        hideTimer.current = null
        setDockHidden(false)
      } else if (!dockHovered.current) {
        scheduleHide()
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [screen])

  useEffect(() => {
    if (incoming === null) return
    if (incoming === 0) {
      if (checkInTarget === 'teammate') {
        dockPinned.current = false
        setIncoming(null)
        setCheckInTarget(null)
        hideTimer.current = window.setTimeout(() => {
          if (!dockHovered.current) setDockHidden(true)
          hideTimer.current = null
        }, 600)
        return
      }
      setIncoming(null)
      setCallSeconds(30)
      setCallOpen(true)
      return
    }
    const id = window.setTimeout(() => setIncoming(incoming - 1), 1000)
    return () => window.clearTimeout(id)
  }, [incoming, checkInTarget])

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
    setCallOpen(false)
    setIncoming(null)
    setComplete(false)
    dockPinned.current = false
    setScreen('summary')
  }
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
  const revealDock = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
    setDockHidden(false)
  }
  const triggerCheckIn = (target: 'me' | 'teammate', scenario: 'none' | 'people' = 'none') => {
    setCallOpen(false)
    setCallSeconds(30)
    setReturnPrompt(false)
    setClosedVideos(new Set())
    setTeammateWindowOffset({ x: 0, y: 0 })
    dockPinned.current = target === 'teammate'
    if (target === 'teammate') revealDock()
    setNudge(false)
    setCheckInTarget(target)
    setSelfJoinScenario(scenario)
    setSelfOffTask(target === 'me')
    setIncoming(3)
  }
  const joinCheckIn = () => {
    if (checkInTarget !== 'teammate' || incoming === null) return
    setIncoming(null)
    setCallSeconds(30)
    setCallOpen(true)
  }
  const closeCall = () => {
    setCallOpen(false)
    setLastCall(Date.now())
    setCallSeconds(30)
    dockPinned.current = false
    hideTimer.current = window.setTimeout(() => {
      if (!dockHovered.current) setDockHidden(true)
      hideTimer.current = null
    }, 600)
    if (checkInTarget === 'me') setReturnPrompt(true)
    else setCheckInTarget(null)
  }
  const closeVideo = (name: string) => {
    const next = new Set(closedVideos).add(name)
    setClosedVideos(next)
    if (checkInTarget === 'me' && people.every((person) => next.has(person.name))) {
      setSelfJoinScenario('none')
      setTeammateWindowOffset({ x: 0, y: 0 })
    }
  }
  if (screen === 'join') return <EntryScreen mode={entryMode} setMode={setEntryMode} code={code} setCode={setCode} sessionName={sessionName} setSessionName={setSessionName} codeCopied={codeCopied} copyCode={() => { navigator.clipboard?.writeText(code); setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1600) }} continueSetup={beginSessionSetup} />

  if (screen === 'consent') return <IntroductionScreen onComplete={finishTutorial} />

  if (screen === 'goals') return <GoalsScreen goals={goals} setGoals={setGoals} onStart={() => { window.wydDesktop?.startTracking({ subject: sessionName, goals: activeGoals }); if (entryMode === 'join') setTimerRunning(true); setScreen('focus') }} />

  if (screen === 'break') return <BreakScreen minutes={upcomingBreakMinutes} seconds={breakSeconds} goals={activeGoals} checked={checked} setChecked={setChecked} onReturn={() => { setBreakSeconds(upcomingBreakMinutes * 60); setFocusSeconds(pomodoroMinutes * 60); setIsTired(false); setScreen('focus') }} />

  if (screen === 'summary') return <SummaryScreen checked={checked} goalCount={activeGoals.length} />

  return <main className={`focus-page ${desktopPreview ? 'desktop-preview' : ''}`}>
    <FocusDock hidden={dockHidden} host={entryMode === 'create'} focusSeconds={focusSeconds} pomodoroMinutes={pomodoroMinutes} pomodorosDone={pomodorosDone} timerRunning={timerRunning} setTimerRunning={setTimerRunning} resetPomodoro={resetPomodoro} selfOffTask={selfOffTask} people={people} checked={checked} setChecked={setChecked} currentGoal={activeGoals[0] || ''} isTired={isTired} signalTired={signalTired} takeBreak={() => { setTimerRunning(false); setScreen('break') }} leaveSession={leaveSession} nudge={nudge} dismissNudge={() => setNudge(false)} tiredNotice={tiredNotice} dismissTiredNotice={() => setTiredNotice(false)} incoming={incoming} checkInTarget={checkInTarget} joinCheckIn={joinCheckIn} onMouseEnter={() => { dockHovered.current = true; if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = null }} onMouseLeave={() => { dockHovered.current = false; if (dockPinned.current) return; if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => { setDockHidden(true); hideTimer.current = null }, 600) }} />
    <div className="demo-menu">
      <button className="demo-trigger" onClick={() => setDemoOpen(!demoOpen)}>Demo <Icon name="arrow" /></button>
      {demoOpen && <div className="demo-popover"><span>Prototype controls</span><button onClick={() => { setDesktopPreview(!desktopPreview); setDemoOpen(false); revealDock() }}>{desktopPreview ? 'Return to WYD!! app' : 'Apple desktop preview'}</button><button onClick={() => { triggerCheckIn('me', 'none'); setDemoOpen(false) }}>I go off task · no one joins</button><button onClick={() => { triggerCheckIn('me', 'people'); setDemoOpen(false) }}>I go off task · people join</button><button onClick={() => { triggerCheckIn('teammate'); setDemoOpen(false) }}>Teammate goes off task</button><div className="corner-setting"><small>Check-in corner</small><div>{(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => <button className={checkInCorner === corner ? 'active' : ''} key={corner} onClick={() => { setCheckInCorner(corner); window.wydDesktop?.setPreferences({ checkInCorner: corner }) }} aria-label={corner}>{corner.split('-').map((part) => part[0].toUpperCase()).join('')}</button>)}</div></div>{entryMode === 'create' && <button onClick={() => { finishPomodoro(); setDemoOpen(false) }}>Finish Pomodoro</button>}<button onClick={() => setScreen('summary')}>End session</button></div>}
    </div>
    {desktopPreview ? <DesktopPreview onReturn={() => setDesktopPreview(false)} /> : <section className="focus-grid">
      <div className="timer-panel"><div className="eyebrow">Focus session · Round {(pomodorosDone % 4) + 1} of 4</div><div className="pomodoro-rounds">{[0, 1, 2, 3].map((round) => <span className={round < pomodorosDone % 4 ? 'done' : round === pomodorosDone % 4 ? 'current' : ''} key={round}><Icon name="check" /></span>)}</div><div className="timer-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" /><circle className="timer-progress" cx="90" cy="90" r="80" style={{ strokeDashoffset: 502 * (1 - focusSeconds / (pomodoroMinutes * 60)) }} /></svg><div><strong>{String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:{String(focusSeconds % 60).padStart(2, '0')}</strong><span>{timerRunning ? 'focus time' : focusSeconds === pomodoroMinutes * 60 ? entryMode === 'create' ? 'ready when you are' : 'waiting for host' : 'paused by host'}</span></div></div><h2>{timerRunning ? 'Stay with it.' : entryMode === 'create' ? 'Choose one task.' : 'Your host sets the pace.'}</h2><p>{activeGoals[0] || 'Pick something that deserves your full attention.'}</p>{entryMode === 'create' ? <div className="pomodoro-console host-console"><div className="console-role"><span className="host-control-badge"><Icon name="users" />Host controls</span><small>Everyone’s timer stays in sync with yours.</small></div><div className="time-select"><span>Focus length</span>{[15, 25, 45].map((minutes) => <button className={pomodoroMinutes === minutes ? 'active' : ''} onClick={() => selectPomodoroLength(minutes)} key={minutes}>{minutes} min</button>)}</div><div className="timer-controls"><button className="timer-stop" onClick={resetPomodoro}><Icon name="x" />Stop</button><button className="timer-start" onClick={() => setTimerRunning(!timerRunning)}><Icon name={timerRunning ? 'clock' : 'arrow'} />{timerRunning ? 'Pause for everyone' : focusSeconds < pomodoroMinutes * 60 ? 'Resume session' : 'Start session'}</button></div><div className="focus-oath"><Icon name="target" /><span><strong>My focus promise</strong>I’ll give this task my full attention until the timer rings.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div> : <div className="pomodoro-console participant-console"><div className="participant-host"><span className="avatar bg-[#dbe9ff]">MK<i /></span><div><small>Session host</small><strong>Maya controls this Pomodoro</strong><p>You’ll start, pause, and take breaks together.</p></div><span className="sync-status"><i />Synced</span></div><div className="participant-schedule"><span><small>Focus</small><strong>{pomodoroMinutes} min</strong></span><Icon name="arrow" /><span><small>Short break</small><strong>5 min</strong></span><Icon name="arrow" /><span><small>After 4 rounds</small><strong>20 min</strong></span></div><div className="focus-oath"><Icon name="lock" /><span><strong>Timer controls are host-only</strong>Your timer updates automatically when Maya starts, pauses, or stops the session.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? '' : 's'} saved for later</small>}</div></div>}</div>
      <SessionSidebar sessionName={sessionName} role={entryMode === 'create' ? 'Host' : 'Participant'} goals={activeGoals} checked={checked} setChecked={setChecked} people={people} />
    </section>}
    {callOpen && checkInTarget === 'teammate' && <section className="teammate-share-window" style={{ transform: `translate(calc(-50% + ${teammateWindowOffset.x}px), calc(-50% + ${teammateWindowOffset.y}px))` }}>
      <header onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.currentTarget.setPointerCapture(event.pointerId); teammateWindowDrag.current = { x: teammateWindowOffset.x, y: teammateWindowOffset.y, startX: event.clientX, startY: event.clientY } }} onPointerMove={(event) => { if (!teammateWindowDrag.current) return; setTeammateWindowOffset({ x: teammateWindowDrag.current.x + event.clientX - teammateWindowDrag.current.startX, y: teammateWindowDrag.current.y + event.clientY - teammateWindowDrag.current.startY }) }} onPointerUp={() => { teammateWindowDrag.current = null }}><div><i /><span>Jake’s screen · group check-in</span></div><em>{callSeconds}s</em><button onClick={closeCall} aria-label="Leave Jake's check-in"><Icon name="x" />Leave</button></header>
      <div className="shared-screen"><div className="shared-browser-bar"><span /><span /><span /><strong>Problem Set 4 — Calculus</strong></div><div className="shared-work"><aside><span>1</span><span>2</span><span>3</span><span>4</span></aside><main><small>QUESTION 4 OF 12</small><h3>Find the derivative of the function</h3><div className="equation">f(x) = 3x³ − 4x² + 7</div><div className="screen-answer">Type your answer…</div></main></div></div>
      <div className="embedded-webcam"><div className={`avatar ${people[1].color}`}>{people[1].initials}<i /></div><span>Jake · webcam</span></div>
      <div className="checkin-observers">{[...people.filter((person) => person.name !== 'Jake'), { name: 'You', initials: 'YO', color: 'bg-[#d9f2e5]' }].map((person) => <div key={person.name}><div className={`avatar ${person.color}`}>{person.initials}</div><span>{person.name}</span></div>)}</div>
      <div className="window-progress"><i style={{ width: `${(callSeconds / 30) * 100}%` }} /></div>
    </section>}
    {callOpen && checkInTarget === 'me' && selfJoinScenario === 'people' && <div className="checkin-timer-pop"><Icon name="clock" /><strong>00:{String(callSeconds).padStart(2, '0')}</strong></div>}
    {callOpen && checkInTarget === 'me' && selfJoinScenario === 'none' && <section className="teammate-share-window duck-reflection-window" style={{ transform: `translate(calc(-50% + ${teammateWindowOffset.x}px), calc(-50% + ${teammateWindowOffset.y}px))` }}>
      <header onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); teammateWindowDrag.current = { x: teammateWindowOffset.x, y: teammateWindowOffset.y, startX: event.clientX, startY: event.clientY } }} onPointerMove={(event) => { if (!teammateWindowDrag.current) return; setTeammateWindowOffset({ x: teammateWindowDrag.current.x + event.clientX - teammateWindowDrag.current.startX, y: teammateWindowDrag.current.y + event.clientY - teammateWindowDrag.current.startY }) }} onPointerUp={() => { teammateWindowDrag.current = null }}><div><i /><span>Quiet accountability · reflection</span></div><em>{callSeconds}s</em></header>
      <div className="duck-reflection-body"><svg className="studying-duck" viewBox="0 0 420 260" role="img" aria-label="A duck studying at a desk"><rect width="420" height="260" rx="24" fill="#edf7f3" /><rect x="54" y="181" width="318" height="16" rx="8" fill="#8e6953" /><rect x="75" y="194" width="15" height="55" rx="7" fill="#765642" /><rect x="338" y="194" width="15" height="55" rx="7" fill="#765642" /><g className="duck-body"><ellipse cx="210" cy="164" rx="66" ry="50" fill="#f4d872" /><ellipse cx="215" cy="101" rx="48" ry="45" fill="#f7dd7c" /><circle cx="231" cy="91" r="4" fill="#344943" /><path d="M251 104c19-8 33-3 38 5-8 10-24 13-39 6Z" fill="#e99b57" /><path d="M164 153c-18 5-25 18-21 35 17-2 28-9 35-23Z" fill="#e6c65f" /></g><g className="duck-pencil"><rect x="250" y="151" width="47" height="6" rx="3" fill="#659d98" transform="rotate(-26 250 151)" /><path d="m291 133 9-1-6 7Z" fill="#544a43" /></g><path d="M130 167c31-18 60-17 82 1v23c-26-12-53-12-82 0Z" fill="#fff" stroke="#b8d7cf" strokeWidth="3" /><path d="M290 167c-31-18-60-17-78 1v23c23-12 49-12 78 0Z" fill="#fff" stroke="#b8d7cf" strokeWidth="3" /><path d="M210 169v22" stroke="#b8d7cf" strokeWidth="3" /></svg><p>No one is here to keep you accountable. Use this time to reflect on your productivity so far.</p></div>
      <div className="window-progress"><i style={{ width: `${(callSeconds / 30) * 100}%` }} /></div>
    </section>}
    {callOpen && checkInTarget === 'me' && selfJoinScenario === 'people' && <section className={`glass-checkin corner-${checkInCorner} self-glass`}>
      {people.slice(0, visibleVideos).map((person) => <div className={`glass-video member-video ${closedVideos.has(person.name) ? 'closed-video' : ''}`} key={person.name}><div className={`avatar ${person.color}`}>{person.initials}</div><span>{person.name}</span><button className="close-video" onClick={() => closeVideo(person.name)} aria-label={`Close ${person.name}'s video`}><Icon name="x" /></button></div>)}
    </section>}
    {returnPrompt && <div className="return-prompt"><span className="list-icon mint"><Icon name="target" /></span><div><strong>Back to {activeGoals[0] || 'your current goal'}?</strong><p>One small step at a time.</p></div><button className="primary" onClick={() => { setReturnPrompt(false); setSelfOffTask(false); setCheckInTarget(null) }}>Let’s go</button></div>}
    {complete && <div className="overlay"><div className="complete-modal"><div className="icon-bubble mint"><Icon name="check" /></div><div className="eyebrow">{pomodoroMinutes} minutes complete</div><h2>Pomodoro complete.</h2><p>{upcomingBreakMinutes >= 20 ? 'That’s four rounds. Take a longer 20-minute break so your brain can recharge.' : 'Mark it complete and take a five-minute break before the next round.'}</p><div className="button-row"><button className="secondary" onClick={() => { setComplete(false); setScreen('summary') }}>End session</button><button className="primary" onClick={() => { setComplete(false); setScreen('break') }}>Take {upcomingBreakMinutes} min break <Icon name="arrow" /></button></div></div></div>}
  </main>
}
