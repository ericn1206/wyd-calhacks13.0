import { useEffect, useRef, useState } from 'react'
import { FocusDock } from '../components/overlays/FocusDock'
import { Icon } from '../components/ui/Icon'
import { people } from '../data/people'
import type { OverlayAction, OverlayState, ToMain, ToOverlay } from './bridge'

const INTERACTIVE = '.focus-dock, .dock-toast, .teammate-share-window, .return-prompt, .glass-video, .checkin-timer-pop'

const send = (message: ToMain) => window.wydDesktop?.bridge.send(message)
const act = (action: OverlayAction) => send({ type: 'action', action })

/**
 * Rendered in the transparent full-screen overlay window (index.html?overlay=1).
 * Owns the dock reveal logic and the check-in state machine; the main window owns the
 * timer, goals and role, and sends them in as `OverlayState`.
 */
export default function OverlayApp() {
  const [s, setS] = useState<OverlayState | null>(null)
  const [callOpen, setCallOpen] = useState(false)
  const [callSeconds, setCallSeconds] = useState(30)
  const [, setLastCall] = useState<number | null>(null)
  const [dockHidden, setDockHidden] = useState(true)
  const [selfOffTask, setSelfOffTask] = useState(false)
  const [incoming, setIncoming] = useState<number | null>(null)
  const [checkInTarget, setCheckInTarget] = useState<'me' | 'teammate' | null>(null)
  const [returnPrompt, setReturnPrompt] = useState(false)
  const [selfJoinScenario, setSelfJoinScenario] = useState<'none' | 'people'>('none')
  const [visibleVideos, setVisibleVideos] = useState(1)
  const [closedVideos, setClosedVideos] = useState<Set<string>>(new Set())
  const [teammateWindowOffset, setTeammateWindowOffset] = useState({ x: 0, y: 0 })
  const hideTimer = useRef<number | null>(null)
  const dockHovered = useRef(false)
  const dockPinned = useRef(false)
  const teammateWindowDrag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const ignoring = useRef(true)

  const currentGoal = s?.currentGoal ?? ''
  const checkInCorner = s?.checkInCorner ?? 'top-right'

  // The window is click-through except over our own UI. Mouse moves are still forwarded while ignoring.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const interactive = Boolean(target?.closest(INTERACTIVE))
      if (interactive === !ignoring.current) return
      ignoring.current = !interactive
      window.wydDesktop?.setIgnoreMouseEvents(!interactive)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    window.wydDesktop?.bridge.onMessage((message) => {
      const m = message as ToOverlay
      if (m.type === 'state') setS(m.state)
      else if (m.type === 'checkIn') triggerCheckInRef.current(m.target, m.scenario)
      else if (m.type === 'reveal') revealDockRef.current()
      else if (m.type === 'reset') resetRef.current()
    })
    send({ type: 'ready' })
    return () => window.wydDesktop?.bridge.removeListeners()
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
  }, [])

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

  const triggerCheckInRef = useRef(triggerCheckIn)
  const revealDockRef = useRef(revealDock)
  const resetRef = useRef(() => {})
  triggerCheckInRef.current = triggerCheckIn
  revealDockRef.current = revealDock
  resetRef.current = () => {
    setCallOpen(false)
    setIncoming(null)
    setCheckInTarget(null)
    setReturnPrompt(false)
    setSelfOffTask(false)
    setClosedVideos(new Set())
    dockPinned.current = false
    setDockHidden(true)
  }

  if (!s) return null

  return <>
    <FocusDock hidden={dockHidden} host={s.host} focusSeconds={s.focusSeconds} pomodoroMinutes={s.pomodoroMinutes} pomodorosDone={s.pomodorosDone} timerRunning={s.timerRunning} setTimerRunning={(running) => act({ type: 'setTimerRunning', running })} resetPomodoro={() => act({ type: 'resetPomodoro' })} selfOffTask={selfOffTask} people={people} checked={s.checked} setChecked={(checked) => act({ type: 'setChecked', checked })} currentGoal={s.currentGoal} isTired={s.isTired} signalTired={() => act({ type: 'signalTired' })} takeBreak={() => act({ type: 'takeBreak' })} leaveSession={() => act({ type: 'leave' })} nudge={false} dismissNudge={() => {}} tiredNotice={s.tiredNotice} dismissTiredNotice={() => act({ type: 'dismissTired' })} incoming={incoming} checkInTarget={checkInTarget} joinCheckIn={joinCheckIn} onMouseEnter={() => { dockHovered.current = true; if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = null }} onMouseLeave={() => { dockHovered.current = false; if (dockPinned.current) return; if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => { setDockHidden(true); hideTimer.current = null }, 600) }} />
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
    {returnPrompt && <div className="return-prompt"><span className="list-icon mint"><Icon name="target" /></span><div><strong>Back to {currentGoal || 'your current goal'}?</strong><p>One small step at a time.</p></div><button className="primary" onClick={() => { setReturnPrompt(false); setSelfOffTask(false); setCheckInTarget(null) }}>Let’s go</button></div>}
  </>
}
