import { useEffect, useRef, useState } from 'react'
import { EntryScreen } from './components/onboarding/EntryScreen'
import { GoalsScreen } from './components/onboarding/GoalsScreen'
import { IntroductionScreen } from './components/onboarding/IntroductionScreen'
import { VoiceScreen } from './components/onboarding/VoiceScreen'
import { BreakScreen } from './components/session/BreakScreen'
import { SessionSidebar } from './components/session/SessionSidebar'
import { SummaryScreen } from './components/session/SummaryScreen'
import type { OverlayState, ToMain, ToOverlay } from './overlay/bridge'
import { Icon } from './components/ui/Icon'
import { useDb } from './db/useDb'

type Screen = 'join' | 'consent' | 'voice' | 'goals' | 'focus' | 'break' | 'summary'
type VoicePhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'
type VoiceContext = { subject: string; goals: string[]; sites: string; notes: string }

function cleanCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function makeSessionCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

// Same alphabet as spacetimedb/src/logic.ts CODE_ALPHABET (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('join')
  const [entryMode, setEntryMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('')
  // Shown on the Create screen and proposed to createSession; the server keeps it unless taken.
  const [inviteCode] = useState(makeInviteCode)
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
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  const [voiceCreds, setVoiceCreds] = useState<{ token: string; agentId: string } | null>(null)
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null)
  const [voiceError, setVoiceError] = useState('')
  const [voiceContext, setVoiceContext] = useState<VoiceContext | null>(null)
  const [voiceSettled, setVoiceSettled] = useState(false)
  const focusStarted = useRef(false)
  const beginFocusRef = useRef<(subject: string, nextGoals: string[], sites?: string, notes?: string) => Promise<void>>(async () => {})
  const [now, setNow] = useState(Date.now())
  const [displayName, setDisplayName] = useState(() => { try { return localStorage.getItem('wyd:name') ?? '' } catch { return '' } })
  const entryStarted = useRef(false)
  // Length the host just picked, shown until the server's work_secs catches up (or the call fails).
  const [pendingWorkSecs, setPendingWorkSecs] = useState<number | null>(null)
  // Length picked while a session runs; switching stops the timer, so ask first.
  const [confirmLength, setConfirmLength] = useState<number | null>(null)
  // The session this client is in; only its end should open the summary (db.ended can be an older one).
  const watchedSessionId = useRef<number | null>(null)
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
    window.sessionAPI?.onPhase(setVoicePhase)
    window.sessionAPI?.onContextReady(setVoiceContext)
    return () => window.sessionAPI?.removeAllListeners()
  }, [])

  useEffect(() => {
    if (screen !== 'voice') return
    let cancelled = false
    void (async () => {
      try {
        if (!window.sessionAPI) throw new Error('The voice interview runs in the desktop app. Type your goals instead.')
        const creds = await window.sessionAPI.start()
        if (cancelled) return
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        setVoiceCreds(creds)
        setVoiceStream(stream)
      } catch (err) {
        if (!cancelled) setVoiceError(err instanceof Error ? err.message : 'Could not start the voice interview.')
      }
    })()
    return () => { cancelled = true }
  }, [screen])

  useEffect(() => {
    if (screen !== 'voice' || !voiceContext || !voiceSettled) return
    const nextGoals = voiceContext.goals.map((goal) => goal.trim()).filter(Boolean).slice(0, 3)
    const subject = voiceContext.subject.trim() || sessionName
    void beginFocusRef.current(subject, nextGoals.length ? nextGoals : [subject || 'Study'], voiceContext.sites, voiceContext.notes)
  }, [screen, voiceContext, voiceSettled, sessionName])


  useEffect(() => {
    if (screen !== 'break' || dbSession) return
    const id = window.setInterval(() => setBreakSeconds((s) => s > 0 ? s - 1 : 0), 1000)
    return () => window.clearInterval(id)
  }, [screen, !!dbSession])

  useEffect(() => {
    // Local demo flow only: in a database session the server's phase_started_at drives every clock.
    if (dbSession || screen !== 'focus' || !timerRunning || focusSeconds <= 0) return
    const id = window.setInterval(() => setFocusSeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(id)
  }, [screen, timerRunning, focusSeconds, dbSession])

  useEffect(() => {
    if (!dbSession && timerRunning && focusSeconds === 0) finishPomodoro()
  }, [focusSeconds, timerRunning])

  // Server-driven session: SpacetimeDB is the single source of truth. Nothing ticks on the server; each
  // client shows phase_started_at + phase length against the server's clock (local clock corrected by
  // the offset measured from server event timestamps), so every screen agrees. Only a phase change
  // (start, take break, timer flip, end) moves the UI between screens.
  const phaseKey = dbSession ? `${dbSession.state}:${dbSession.phase}:${dbSession.cycle}` : ''
  const serverActive = dbSession?.state === 'Active' || dbSession?.state === 'Break'
  const sessionStarted = dbSession ? serverActive : timerRunning || focusSeconds < pomodoroMinutes * 60
  useEffect(() => {
    if (!serverActive) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [serverActive])

  const serverNow = now - (db.snapshot.clockOffsetMs ?? 0)
  const elapsedSecs = dbSession?.phaseStartedAt ? Math.max(0, Math.floor((serverNow - dbSession.phaseStartedAt) / 1000)) : 0
  useEffect(() => {
    if (!dbSession) return
    setSessionName(dbSession.name)
    setCode(dbSession.code)
    setUpcomingBreakMinutes(Math.round(dbSession.breakSecs / 60))
    if (pendingWorkSecs !== null) {
      // Keep the host's just-picked length on screen until the server reports it.
      if (dbSession.workSecs !== pendingWorkSecs) return
      setPendingWorkSecs(null)
    }
    setPomodoroMinutes(Math.round(dbSession.workSecs / 60))
    if (dbSession.state === 'Lobby') { setFocusSeconds(dbSession.workSecs); setTimerRunning(false) }
    else if (dbSession.state === 'Active') { setFocusSeconds(Math.max(0, dbSession.workSecs - elapsedSecs)); setTimerRunning(true) }
    else if (dbSession.state === 'Break') { setBreakSeconds(Math.max(0, dbSession.breakSecs - elapsedSecs)); setTimerRunning(false) }
  }, [dbSession?.name, dbSession?.code, dbSession?.workSecs, dbSession?.breakSecs, dbSession?.state, phaseKey, elapsedSecs, pendingWorkSecs])

  useEffect(() => {
    if (!dbSession) return
    setComplete(false)
    if (dbSession.state === 'Active') {
      setPomodorosDone(dbSession.cycle - 1)
      setIsTired(false)
      setScreen((s) => (s === 'break' ? 'focus' : s))
    } else if (dbSession.state === 'Break') {
      setPomodorosDone(dbSession.cycle)
      setScreen((s) => (s === 'focus' ? 'break' : s))
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

  useEffect(() => {
    if (dbSession) watchedSessionId.current = dbSession.id
  }, [dbSession?.id])

  // The host ended the session (or the last person left): everyone still in it goes to the summary.
  // Right after Create/Join the new session may not have arrived yet, so db.ended can still be the
  // previous session; only the session we were watching counts.
  useEffect(() => {
    if (db.ended && db.ended.sessionId === watchedSessionId.current && (screen === 'focus' || screen === 'break' || screen === 'goals')) {
      watchedSessionId.current = null
      setComplete(false)
      setTimerRunning(false)
      setScreen('summary')
    }
  }, [db.ended?.sessionId, screen])

  // The dock and check-in windows live in the full-screen overlay window (see overlay/OverlayApp.tsx).
  const [overlayReady, setOverlayReady] = useState(0)
  const overlayVisible = useRef(false)
  const handlers = useRef({ signalTired: () => {}, takeBreak: () => {}, endBreak: () => {}, leaveSession: () => {}, resetPomodoro: () => {}, setRunning: (_running: boolean) => {}, setChecked: (_checked: boolean[]) => {} })

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
      else if (a.type === 'endBreak') handlers.current.endBreak()
      else if (a.type === 'leave') handlers.current.leaveSession()
    })
    return () => bridge.removeListeners()
  }, [])

  useEffect(() => {
    // The dock stays up through breaks; reset the overlay only when it first appears.
    const visible = screen === 'focus' || screen === 'break'
    const appearing = visible && !overlayVisible.current
    overlayVisible.current = visible
    window.wydDesktop?.setOverlayVisible(visible).then(() => { if (appearing) window.wydDesktop?.bridge.send({ type: 'reset' }) })
  }, [screen])

  const meName = db.people.find((person) => person.me)?.name
  const displayName = meName && meName !== 'guest' ? meName : 'Friend'
  const sessionCode = cleanCode(dbSession?.code || code)
  const shareCall = screen === 'focus' || screen === 'break'
  const members = db.people.filter((person) => !person.me).map((person) => ({
    name: person.name, initials: person.initials, status: person.status, hex: person.hex,
  }))
  const membersKey = members.map((person) => `${person.name}:${person.status}:${person.hex ?? ''}`).join('|')

  useEffect(() => {
    const state: OverlayState = {
      host: isHost, serverPhase: dbSession?.state ?? null, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning,
      started: sessionStarted, onBreak: screen === 'break', breakSeconds, breakMinutes: upcomingBreakMinutes,
      checked, currentGoal: goals.find((g) => g.trim()) || '', isTired, tiredNotice, checkInCorner,
      sessionCode: shareCall ? sessionCode : '', displayName, members,
    }
    window.wydDesktop?.bridge.send({ type: 'state', state })
  }, [overlayReady, isHost, dbSession?.state, focusSeconds, pomodoroMinutes, pomodorosDone, timerRunning, sessionStarted, screen, breakSeconds, upcomingBreakMinutes, checked, goals, isTired, tiredNotice, checkInCorner, shareCall, sessionCode, displayName, membersKey])

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
    if (minutes === pomodoroMinutes) return
    if (dbSession && !dbSession.isHost) return
    if (sessionStarted) return setConfirmLength(minutes)
    applyPomodoroLength(minutes)
  }
  const applyPomodoroLength = (minutes: number) => {
    if (dbSession) {
      if (!dbSession.isHost) return
      // Show it now; the server stops a running timer and confirms the new length.
      setPendingWorkSecs(minutes * 60)
      setPomodoroMinutes(minutes)
      setFocusSeconds(minutes * 60)
      setTimerRunning(false)
      db.call('setPomodoro', { workSecs: minutes * 60, breakSecs: dbSession.breakSecs }).then((error) => {
        if (!error) return
        setPendingWorkSecs(null) // the sync effect restores the server's values
        window.alert(error)
      })
      return
    }
    setPomodoroMinutes(minutes)
    setFocusSeconds(minutes * 60)
    setTimerRunning(false)
  }
  const resetPomodoro = () => {
    if (dbSession) return // no stop in a session: the host takes a break or ends it
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
  const returnFromBreak = () => {
    if (dbSession) return // the server's timer ends the break for everyone
    setBreakSeconds(upcomingBreakMinutes * 60)
    setFocusSeconds(pomodoroMinutes * 60)
    setIsTired(false)
    setScreen('focus')
  }
  const sendToOverlay = (message: ToOverlay) => window.wydDesktop?.bridge.send(message)
  const triggerCheckIn = (target: 'me' | 'teammate', scenario: 'none' | 'people' = 'none') => sendToOverlay({ type: 'checkIn', target, scenario })
  const setRunning = (running: boolean) => {
    if (dbSession) {
      if (!running || !dbSession.isHost || dbSession.state !== 'Lobby') return
      db.call('startSession').then((error) => { if (error) window.alert(error) })
      return
    }
    setTimerRunning(running)
  }
  const updateChecked = (next: boolean[]) => {
    setChecked(next)
    if (!dbSession) return
    next.forEach((done, i) => {
      const goal = db.myGoals[i]
      if (goal && !!goal.completed !== done) db.call('checkGoal', { goalId: BigInt(goal.id), done }).then((error) => {
        if (error) setChecked(db.myGoals.map((g) => !!g.completed))
      })
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
      watchedSessionId.current = null
      setEntryError('')
      setEntryBusy(true)
      const name = displayName.trim()
      if (name) {
        try { localStorage.setItem('wyd:name', name) } catch { /* optional */ }
        const nameError = await db.call('setProfile', { displayName: name, avatarColor: '#7C8CF8' })
        if (nameError) { setEntryBusy(false); return setEntryError(nameError) }
      }
      const unset = { pomodoroWorkSecs: undefined, pomodoroBreakSecs: undefined, offTaskThresholdSecs: undefined, callCooldownSecs: undefined, maxCallSecs: undefined, scoreboardEnabled: undefined, groupCallEnabled: undefined, topicDescription: undefined, allowedDomains: undefined, blockedDomains: undefined }
      const error = entryMode === 'create' ? await db.call('createSession', { name: sessionName.trim(), settings: unset, code: inviteCode }) : await db.call('joinSession', { code: code.trim() })
      setEntryBusy(false)
      if (error) return setEntryError(error)
    }
    try {
      setScreen(localStorage.getItem('wyd:tutorial-complete') === 'true' ? 'voice' : 'consent')
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
    setScreen('voice')
  }
  const beginFocus = async (subject: string, nextGoals: string[], sites = '', notes = '') => {
    if (focusStarted.current) return
    focusStarted.current = true
    const active = nextGoals.map((goal) => goal.trim()).filter(Boolean)
    setGoals([...active, '', '', ''].slice(0, 3))
    setChecked([false, false, false])
    if (subject.trim()) setSessionName(subject.trim())
    if (dbSession && active.length) {
      const error = await db.call('setGoals', { goals: active })
      if (error) {
        focusStarted.current = false
        window.alert(error)
        return
      }
    }
    if (!dbSession && cleanCode(code).length < 4) setCode(makeSessionCode())
    window.wydDesktop?.startTracking({ subject: subject.trim() || sessionName, goals: active, sites, notes })
    if (!dbSession && entryMode === 'join') setTimerRunning(true)
    voiceStream?.getTracks().forEach((track) => track.stop())
    setScreen('focus')
  }
  beginFocusRef.current = beginFocus
  const skipVoice = () => {
    voiceStream?.getTracks().forEach((track) => track.stop())
    setVoiceStream(null)
    setScreen('goals')
  }
  handlers.current = { signalTired, takeBreak, endBreak: returnFromBreak, leaveSession, resetPomodoro, setRunning, setChecked: updateChecked }

  if (screen === 'join') return <EntryScreen error={entryError} busy={entryBusy} mode={entryMode} setMode={setEntryMode} code={entryMode === 'create' && !dbSession ? '······' : code} setCode={setCode} sessionName={sessionName} setSessionName={setSessionName} codeCopied={codeCopied} copyCode={() => { navigator.clipboard?.writeText(code); setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1600) }} continueSetup={beginSessionSetup} displayName={displayName} setDisplayName={setDisplayName} />

  if (screen === 'consent') return <IntroductionScreen onComplete={finishTutorial} />

  if (screen === 'voice') return <VoiceScreen phase={voicePhase} creds={voiceCreds} stream={voiceStream} error={voiceError} onTranscript={(transcript) => { void window.sessionAPI.submitResponse(transcript).catch((err) => setVoiceError(err instanceof Error ? err.message : 'Could not save the interview.')) }} onSettled={() => setVoiceSettled(true)} onTypeInstead={skipVoice} />

  if (screen === 'goals') return <GoalsScreen goals={goals} setGoals={setGoals} onStart={() => { void beginFocus(sessionName, activeGoals) }} />

  if (screen === 'break') return <BreakScreen minutes={upcomingBreakMinutes} seconds={breakSeconds} goals={activeGoals} checked={checked} setChecked={updateChecked} onReturn={dbSession ? undefined : returnFromBreak} onEnd={dbSession?.isHost ? endSession : undefined} />

  if (screen === 'summary') return <SummaryScreen checked={checked} goalCount={activeGoals.length} stats={db.ended} />

  return <main className="focus-page">
    <div className="demo-menu">
      <button className="demo-trigger" onClick={() => setDemoOpen(!demoOpen)}>Demo <Icon name="arrow" /></button>
      {demoOpen && <div className="demo-popover"><span>Prototype controls</span><button onClick={() => { triggerCheckIn('me', 'none'); setDemoOpen(false) }}>I go off task · no one joins</button><button onClick={() => { triggerCheckIn('me', 'people'); setDemoOpen(false) }}>I go off task · people join</button><button onClick={() => { triggerCheckIn('teammate'); setDemoOpen(false) }}>Teammate goes off task</button><div className="corner-setting"><small>Check-in corner</small><div>{(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => <button className={checkInCorner === corner ? 'active' : ''} key={corner} onClick={() => { setCheckInCorner(corner); window.wydDesktop?.setPreferences({ checkInCorner: corner }) }} aria-label={corner}>{corner.split('-').map((part) => part[0].toUpperCase()).join('')}</button>)}</div></div>{isHost && !dbSession && <button onClick={() => { finishPomodoro(); setDemoOpen(false) }}>Finish Pomodoro</button>}<button onClick={endSession}>{dbSession && !isHost ? 'Leave session' : 'End session'}</button></div>}
    </div>
    <section className="focus-grid">
      <div className="timer-panel"><div className="eyebrow">Focus session · Round {(pomodorosDone % 4) + 1} of 4</div><div className="pomodoro-rounds">{[0, 1, 2, 3].map((round) => <span className={round < pomodorosDone % 4 ? ‘done’ : round === pomodorosDone % 4 ? ‘current’ : ‘’} key={round}><Icon name="check" /></span>)}</div><div className="timer-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" /><circle className="timer-progress" cx="90" cy="90" r="80" style={{ strokeDashoffset: 502 * (1 - focusSeconds / (pomodoroMinutes * 60)) }} /></svg><div><strong>{String(Math.floor(focusSeconds / 60)).padStart(2, ‘0’)}:{String(focusSeconds % 60).padStart(2, ‘0’)}</strong><span>{timerRunning ? ‘focus time’ : focusSeconds === pomodoroMinutes * 60 ? isHost ? ‘ready when you are’ : ‘waiting for host’ : ‘paused by host’}</span></div></div><h2>{timerRunning ? ‘Stay with it.’ : isHost ? ‘Choose one task.’ : ‘Your host sets the pace.’}</h2>{dbSession?.state === ‘Lobby’ && <p className="lobby-line">Invite code <strong>{dbSession.code}</strong> · {db.people.length} in the room</p>}<p>{activeGoals[0] || ‘Pick something that deserves your full attention.’}</p>{isHost ? <div className="pomodoro-console host-console"><div className="console-role"><span className="host-control-badge"><Icon name="users" />Host controls</span><small>Everyone’s timer stays in sync with yours.</small></div><div className="time-select"><span>Focus length</span>{[15, 25, 45].map((minutes) => <button className={pomodoroMinutes === minutes ? ‘active’ : ‘’} onClick={() => selectPomodoroLength(minutes)} key={minutes}>{minutes} min</button>)}</div><div className="timer-controls">{sessionStarted && <button className="timer-stop" disabled={!!dbSession && dbSession.state !== ‘Active’} onClick={() => dbSession ? takeBreak() : resetPomodoro()}><Icon name={dbSession ? ‘clock’ : ‘x’} />{dbSession ? ‘Take a break’ : ‘Stop’}</button>}<button className="timer-start" disabled={!!dbSession && (dbSession.state !== ‘Lobby’ || timerRunning)} onClick={() => dbSession ? setRunning(true) : setTimerRunning(!timerRunning)}><Icon name={timerRunning ? ‘clock’ : ‘arrow’} />{dbSession ? (dbSession.state === ‘Lobby’ && !timerRunning ? ‘Start session’ : ‘Session running’) : timerRunning ? ‘Pause for everyone’ : focusSeconds < pomodoroMinutes * 60 ? ‘Resume session’ : ‘Start session’}</button></div>{dbSession && dbSession.state !== ‘Lobby’ && <button className="end-session-button" onClick={endSession}><Icon name="x" />End session for everyone</button>}<div className="focus-oath"><Icon name="target" /><span><strong>My focus promise</strong>I’ll give this task my full attention until the timer rings.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === ‘Enter’ && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? ‘’ : ‘s’} saved for later</small>}</div></div> : <div className="pomodoro-console participant-console"><div className="participant-host"><span className="avatar bg-[#dbe9ff]">MK<i /></span><div><small>Session host</small><strong>{hostName} controls this Pomodoro</strong><p>You’ll start, pause, and take breaks together.</p></div><span className="sync-status"><i />Synced</span></div><div className="participant-schedule"><span><small>Focus</small><strong>{pomodoroMinutes} min</strong></span><Icon name="arrow" /><span><small>Short break</small><strong>5 min</strong></span><Icon name="arrow" /><span><small>After 4 rounds</small><strong>20 min</strong></span></div><div className="focus-oath"><Icon name="lock" /><span><strong>Timer controls are host-only</strong>Your timer updates automatically when {hostName} starts the session.</span></div><div className="distraction-capture"><input value={distraction} onChange={(event) => setDistraction(event.target.value)} onKeyDown={(event) => event.key === ‘Enter’ && saveDistraction()} placeholder="Something else came to mind? Park it here." /><button onClick={saveDistraction}>Save</button>{savedDistractions.length > 0 && <small>{savedDistractions.length} item{savedDistractions.length === 1 ? ‘’ : ‘s’} saved for later</small>}</div></div>}</div>
      <SessionSidebar sessionName={sessionName} role={isHost ? ‘Host’ : ‘Participant’} goals={activeGoals} checked={checked} setChecked={updateChecked} people={dbSession ? db.people.filter((p) => !p.me) : people} />
    </section>
    {complete && <div className="overlay"><div className="complete-modal"><div className="icon-bubble mint"><Icon name="check" /></div><div className="eyebrow">{pomodoroMinutes} minutes complete</div><h2>Pomodoro complete.</h2><p>{upcomingBreakMinutes >= 20 ? 'That’s four rounds. Take a longer 20-minute break so your brain can recharge.' : 'Mark it complete and take a five-minute break before the next round.'}</p><div className="button-row"><button className="secondary" onClick={() => { setComplete(false); endSession() }}>{dbSession && !isHost ? 'Leave session' : 'End session'}</button><button className="primary" onClick={() => { setComplete(false); setScreen('break') }}>Take {upcomingBreakMinutes} min break <Icon name="arrow" /></button></div></div></div>}
    {confirmLength !== null && <div className="overlay"><div className="complete-modal"><div className="icon-bubble mint"><Icon name="clock" /></div><div className="eyebrow">Switch to {confirmLength} minutes</div><h2>End the current session?</h2><p>Are you sure you want to end the current session? Switching to {confirmLength} minutes stops the timer{dbSession ? ' for everyone' : ''} and starts the round over.</p><div className="button-row"><button className="secondary" onClick={() => setConfirmLength(null)}>Keep going</button><button className="primary" onClick={() => { applyPomodoroLength(confirmLength); setConfirmLength(null) }}>End and switch <Icon name="arrow" /></button></div></div></div>}
  </main>
}
