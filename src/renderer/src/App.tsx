import React, { useState, useEffect, useRef } from 'react'
import type { ActivityState, ActivityEntry } from '../../main/activityMonitor'
import type { OnboardingPhase } from '../../main/sessionManager'
import { useCartesiaCall, type AgentCredentials } from './cartesiaCall'
import { VideoCallOverlay } from './VideoCall'
import { useCircleCall, type CircleRoom } from './useCircleCall'

const AUTO_CALL_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_SIGNAL_URL = 'ws://localhost:8787'

const COLORS = {
  productive: '#22c55e',
  distracted: '#ef4444',
  neutral: '#f97316',
  unknown: '#6b7280'
}

const LABELS = {
  productive: 'Focused',
  distracted: 'Distracted',
  neutral: 'Neutral',
  unknown: 'Unknown'
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

function formatDuration(s: number) {
  if (s < 60) return `${Math.floor(s)}s`
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`
}

function Badge({ category }: { category: ActivityEntry['category'] }) {
  const c = COLORS[category]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: c + '22', color: c, border: `1px solid ${c}44`
    }}>
      {LABELS[category]}
    </span>
  )
}

// ── Landing / Onboarding ────────────────────────────────────────────────────

function cleanCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function makeSessionCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function saved(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid #2a2a2a',
  background: '#1a1a1a',
  color: '#f5f5f5',
  fontSize: 15,
  outline: 'none',
}

function SessionLobby({ onJoin }: { onJoin: (room: CircleRoom) => void }) {
  const [name, setName] = useState(() => saved('lockin:name', ''))
  const [code, setCode] = useState(() => saved('lockin:code', ''))
  const [signalUrl, setSignalUrl] = useState(() => saved('lockin:signal', DEFAULT_SIGNAL_URL))
  const [hostUrls, setHostUrls] = useState<string[]>([])

  useEffect(() => {
    window.circleAPI?.getSignalInfo().then((info) => {
      setHostUrls(info.urls.filter((url) => !url.includes('localhost')))
    }).catch(() => undefined)
  }, [])

  const sessionCode = cleanCode(code)
  const canJoin = name.trim().length > 0 && sessionCode.length >= 4

  const submit = () => {
    if (!canJoin) return
    const room = {
      name: name.trim().slice(0, 24),
      sessionCode,
      signalUrl: signalUrl.trim() || DEFAULT_SIGNAL_URL,
    }
    try {
      localStorage.setItem('lockin:name', room.name)
      localStorage.setItem('lockin:code', room.sessionCode)
      localStorage.setItem('lockin:signal', room.signalUrl)
    } catch {
      // private mode
    }
    onJoin(room)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', gap: 18, padding: 32,
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f5f5f5', margin: 0 }}>Lock In</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: 0, textAlign: 'center', maxWidth: 380 }}>
        Share a study session code. When someone drifts, the circle pops into a short video check-in.
      </p>

      <form
        onSubmit={(event) => { event.preventDefault(); submit() }}
        style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600 }}>Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex"
            style={fieldStyle}
            autoFocus
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600 }}>Study session code</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={code}
              onChange={(event) => setCode(cleanCode(event.target.value))}
              placeholder="K7MQ"
              style={{ ...fieldStyle, letterSpacing: 2, fontWeight: 700 }}
            />
            <button
              type="button"
              onClick={() => setCode(makeSessionCode())}
              style={{
                padding: '0 14px', borderRadius: 10, border: '1px solid #2a2a2a',
                background: '#1a1a1a', color: '#d1d5db', cursor: 'pointer', fontWeight: 600,
              }}
            >
              New
            </button>
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600 }}>Signal server</span>
          <input
            value={signalUrl}
            onChange={(event) => setSignalUrl(event.target.value)}
            placeholder={DEFAULT_SIGNAL_URL}
            style={{ ...fieldStyle, fontSize: 13 }}
          />
        </label>

        <button type="submit" disabled={!canJoin} style={{
          marginTop: 4, padding: '14px 20px', borderRadius: 12, border: 'none',
          background: canJoin ? '#6366f1' : '#27272a',
          color: canJoin ? '#fff' : '#6b7280',
          fontSize: 16, fontWeight: 700,
          cursor: canJoin ? 'pointer' : 'default',
        }}>
          Join session
        </button>
      </form>

      <p style={{ color: '#4b5563', fontSize: 12, margin: 0, textAlign: 'center', maxWidth: 380, lineHeight: 1.5 }}>
        {hostUrls.length > 0
          ? `Friends on this Wi-Fi can use ${hostUrls[0]}. Same computer: leave the server as localhost and join the same code.`
          : 'Everyone in the circle uses the same code and the same signal server. This computer hosts it on localhost.'}
      </p>
    </div>
  )
}

function OnboardingScreen({
  phase,
  creds,
  stream,
  startError,
  onTranscript,
  onSettled,
  onBack
}: {
  phase: OnboardingPhase
  creds: AgentCredentials | null
  stream: MediaStream | null
  startError: string
  onTranscript: (t: string) => void
  onSettled: () => void
  onBack: () => void
}) {
  const call = useCartesiaCall(creds, stream, onTranscript, onSettled)
  const error = startError || call.error
  const speaking = call.status === 'speaking'
  const transcriptRef = useRef<HTMLDivElement>(null)
  const label = error
    ? error
    : phase === 'processing'
      ? 'Setting up your session...'
      : speaking
        ? 'Agent is speaking...'
        : creds
          ? 'Listening — answer when you are ready'
          : 'Connecting to the voice agent...'

  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [call.transcript])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20, padding: 40 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 40 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{
            width: 6, borderRadius: 3,
            background: error ? '#ef4444' : '#6366f1',
            animation: speaking ? `wave 1s ease-in-out ${i * 0.1}s infinite alternate` : undefined,
            height: speaking ? `${20 + i * 5}px` : '8px'
          }} />
        ))}
      </div>
      <p style={{ color: error ? '#fca5a5' : '#d1d5db', fontSize: 15, textAlign: 'center', maxWidth: 420, margin: 0 }}>
        {label}
      </p>
      {call.transcript.length > 0 && (
        <div
          ref={transcriptRef}
          style={{
            width: '100%', maxWidth: 440, maxHeight: 280, overflowY: 'auto',
            background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          {call.transcript.map(turn => (
            <div key={turn.id}>
              <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                {turn.role === 'user' ? 'You' : 'Lock In'}
              </div>
              <div style={{
                color: turn.role === 'user' ? '#f5f5f5' : '#c7d2fe',
                fontSize: 14, lineHeight: 1.45, marginTop: 2,
              }}>
                {turn.text || '…'}
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onBack} style={{
        background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12,
      }}>
        Wrong session code?
      </button>
    </div>
  )
}

// ── Active Dashboard ────────────────────────────────────────────────────────

const defaultState: ActivityState = {
  appName: 'Loading...', windowTitle: '', category: 'unknown', reason: '',
  judgedByClaude: false, consecutiveDistractedSeconds: 0, alertLevel: 'none',
  sessionStartTime: Date.now(), sessionContext: null, history: []
}

function Dashboard({ state, room, connection, connectionError, peers, callActive, inCall, onCall, onLeaveSession }: {
  state: ActivityState
  room: CircleRoom
  connection: 'idle' | 'connecting' | 'connected' | 'error'
  connectionError: string
  peers: { peerId: string; name: string }[]
  callActive: boolean
  inCall: boolean
  onCall: () => void
  onLeaveSession: () => void
}) {
  const color = COLORS[state.category]
  const showTimer = state.consecutiveDistractedSeconds > 0
  const [hostUrl, setHostUrl] = useState('')

  useEffect(() => {
    window.circleAPI?.getSignalInfo().then((info) => {
      const lan = info.urls.find((url) => !url.includes('localhost') && !url.includes('127.0.0.1'))
      if (lan) setHostUrl(lan)
    }).catch(() => undefined)
  }, [])
  const timerColor = state.alertLevel === 'alert' ? '#ef4444' : '#f97316'
  const history = [...state.history].reverse().slice(0, 10)

  return (
    <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 24 }}>🔒</span>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f5f5f5', margin: 0 }}>Lock In</h1>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4b5563' }}>
          {formatTime(state.sessionStartTime)}
        </span>
        <button type="button" onClick={onLeaveSession} style={{
          background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12,
        }}>
          Leave
        </button>
      </div>

      <div style={{
        background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
        padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 1, textTransform: 'uppercase' }}>Study session</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, minWidth: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 2, color: '#f5f5f5' }}>{room.sessionCode}</span>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(room.sessionCode).catch(() => undefined) }}
              style={{
                border: 'none', background: '#27272a', color: '#d1d5db', borderRadius: 999,
                padding: '3px 8px', fontSize: 11, cursor: 'pointer',
              }}
            >
              Copy
            </button>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: connection === 'connected' ? '#22c55e' : connection === 'error' ? '#ef4444' : '#f97316',
            }} />
            <span style={{ color: '#9ca3af', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[room.name, ...peers.map((peer) => peer.name)].join(' · ')}
            </span>
          </div>
          {connectionError && (
            <div style={{ color: '#fdba74', fontSize: 12, marginTop: 6 }}>{connectionError}</div>
          )}
          {peers.length === 0 && connection === 'connected' && (
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
              {hostUrl
                ? `On a friend’s computer, open Lock In, enter ${room.sessionCode}, and set the signal server to ${hostUrl}. You both need the same Wi-Fi.`
                : `Share ${room.sessionCode}. Someone on this computer can join at ${room.signalUrl}.`}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCall}
          disabled={connection !== 'connected'}
          style={{
            padding: '10px 14px', borderRadius: 10, border: 'none', flexShrink: 0,
            background: connection === 'connected' ? '#6366f1' : '#27272a',
            color: connection === 'connected' ? '#fff' : '#6b7280',
            fontWeight: 700, cursor: connection === 'connected' ? 'pointer' : 'default',
          }}
        >
          {callActive && !inCall ? 'Rejoin call' : 'Call circle'}
        </button>
      </div>

      {/* Session context pill */}
      {state.sessionContext && (
        <div style={{
          background: '#1a1a2e', border: '1px solid #6366f133', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: 16, lineHeight: '18px' }}>🎯</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 0.6, textTransform: 'uppercase' }}>Studying</div>
            <div style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>
              {state.sessionContext.subject}
            </div>
            {state.sessionContext.goals.length > 0 && (
              <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
                {state.sessionContext.goals.join(' · ')}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 10 }}>Sites</div>
            <div style={{ color: '#e5e7eb', fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>
              {state.sessionContext.sites || 'None named'}
            </div>
          </div>
          {state.judgedByClaude && (
            <span style={{ flexShrink: 0, fontSize: 11, color: '#6366f1', background: '#6366f111', padding: '2px 8px', borderRadius: 999 }}>
              Claude judge
            </span>
          )}
        </div>
      )}

      {/* Alert banner */}
      {state.alertLevel === 'alert' && (
        <div style={{
          background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <span style={{ color: '#fca5a5', fontWeight: 600, fontSize: 14 }}>
            Sustained distraction — your circle gets a short check-in
          </span>
        </div>
      )}

      {/* Status card */}
      <div style={{
        background: '#1a1a1a', border: `1px solid ${color}33`, borderRadius: 14,
        padding: '18px 22px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 18
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: color + '22', border: `3px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          animation: state.category === 'distracted' ? 'pulse-ring 2s infinite' : undefined
        }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: color, opacity: 0.9 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Currently Active</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f5f5f5', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.appName}
          </div>
          {state.windowTitle && state.windowTitle !== state.appName && (
            <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
              {state.windowTitle}
            </div>
          )}
          {state.url && (
            <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
              {state.url}
            </div>
          )}
          <Badge category={state.category} />
          {state.reason && state.reason !== state.appName && (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{state.reason}</span>
          )}
        </div>
      </div>

      {/* Distraction timer */}
      {showTimer && (
        <div style={{
          background: timerColor + '11', border: `1px solid ${timerColor}44`, borderRadius: 10,
          padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span>{state.alertLevel === 'alert' ? '🔴' : '🟠'}</span>
          <span style={{ color: timerColor, fontWeight: 600, fontSize: 14 }}>
            Distracted for {formatDuration(state.consecutiveDistractedSeconds)}
          </span>
          {state.alertLevel === 'warning' && (
            <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>
              Alert in {formatDuration(60 - state.consecutiveDistractedSeconds)}
            </span>
          )}
        </div>
      )}

      {/* Activity log */}
      <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
          Activity Log
        </div>
        {history.length === 0 ? (
          <div style={{ padding: '18px 16px', color: '#4b5563', textAlign: 'center', fontSize: 13 }}>
            Waiting for activity...
          </div>
        ) : history.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} style={{
            padding: '9px 16px', borderBottom: i < history.length - 1 ? '1px solid #1f1f1f' : undefined,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <span style={{ color: '#4b5563', fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {formatTime(entry.timestamp)}
            </span>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS[entry.category], flexShrink: 0 }} />
            <span style={{ flex: 1, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
              {entry.appName}
              {entry.reason !== entry.appName && (
                <span style={{ color: '#6b7280', marginLeft: 6 }}>— {entry.reason}</span>
              )}
            </span>
            <Badge category={entry.category} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Root ────────────────────────────────────────────────────────────────────

type AppPhase = 'landing' | OnboardingPhase | 'active'

export default function App() {
  const [appPhase, setAppPhase] = useState<AppPhase>('landing')
  const [activityState, setActivityState] = useState<ActivityState>(defaultState)
  const [lobby, setLobby] = useState<CircleRoom | null>(null)
  const [creds, setCreds] = useState<AgentCredentials | null>(null)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [startError, setStartError] = useState('')
  const [contextReady, setContextReady] = useState(false)
  const [callSettled, setCallSettled] = useState(false)
  const circle = useCircleCall(lobby)
  const lastAutoCall = useRef(0)
  const startCallRef = useRef(circle.startCall)
  startCallRef.current = circle.startCall

  useEffect(() => {
    if (!window.activityAPI || !window.sessionAPI) return
    window.activityAPI.onUpdate(setActivityState)
    window.sessionAPI.onPhase(phase => {
      if (phase !== 'done') setAppPhase(phase)
    })
    window.sessionAPI.onContextReady(() => setContextReady(true))
    return () => {
      window.activityAPI.removeAllListeners()
      window.sessionAPI.removeAllListeners()
    }
  }, [])

  useEffect(() => {
    if (appPhase !== 'active') return
    if (activityState.alertLevel !== 'alert') return
    if (circle.inCall || circle.joining || circle.callActive) {
      lastAutoCall.current = Date.now()
      return
    }
    if (circle.status !== 'connected') return
    if (Date.now() - lastAutoCall.current < AUTO_CALL_COOLDOWN_MS) return
    lastAutoCall.current = Date.now()
    startCallRef.current()
  }, [activityState.alertLevel, appPhase, circle.status, circle.callActive, circle.inCall, circle.joining])

  const callModeOn = useRef(false)
  useEffect(() => {
    const onCall = circle.inCall || circle.joining || Boolean(circle.callError)
    if (onCall === callModeOn.current) return
    callModeOn.current = onCall
    void window.circleAPI?.setCallMode(onCall)
  }, [circle.inCall, circle.joining, circle.callError])

  useEffect(() => {
    if (contextReady && callSettled) {
      micStream?.getTracks().forEach(track => track.stop())
      setAppPhase('active')
    }
  }, [contextReady, callSettled, micStream])

  const handleStart = async () => {
    setStartError('')
    setAppPhase('speaking')
    try {
      const sessionCreds = await window.sessionAPI.start()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      setCreds(sessionCreds)
      setMicStream(stream)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      const message = err instanceof Error ? err.message : 'Could not start the voice agent'
      const denied = name === 'NotAllowedError' || /permission|notallowed|denied/i.test(message)
      setStartError(
        denied
          ? 'Microphone access is off. Turn it on for Electron in System Settings, then start the session again.'
          : message
      )
      setAppPhase('listening')
    }
  }

  const handleTranscript = (t: string) => {
    setAppPhase('processing')
    window.sessionAPI.submitResponse(t)
  }

  const handleJoin = (room: CircleRoom) => {
    setLobby(room)
    if (!window.sessionAPI) {
      setAppPhase('active')
      return
    }
    void handleStart()
  }

  const backToLobby = () => {
    micStream?.getTracks().forEach(track => track.stop())
    setMicStream(null)
    setCreds(null)
    setStartError('')
    setContextReady(false)
    setCallSettled(false)
    setLobby(null)
    setAppPhase('landing')
  }

  const onCircleCall = () => {
    if (circle.callActive && !circle.inCall) circle.joinCall()
    else circle.startCall()
  }

  const closeCall = () => {
    if (circle.callError) circle.dismissCallError()
    else circle.leaveCall()
  }

  const showCall = appPhase === 'active' && Boolean(lobby) && (circle.inCall || circle.joining || Boolean(circle.callError))

  return (
    <>
      {!lobby && <SessionLobby onJoin={handleJoin} />}
      {lobby && appPhase !== 'active' && (
        <OnboardingScreen
          phase={appPhase === 'landing' ? 'speaking' : appPhase}
          creds={creds}
          stream={micStream}
          startError={startError}
          onTranscript={handleTranscript}
          onSettled={() => setCallSettled(true)}
          onBack={backToLobby}
        />
      )}
      {lobby && appPhase === 'active' && (
        <Dashboard
          state={activityState}
          room={lobby}
          connection={circle.status}
          connectionError={circle.error}
          peers={circle.peers}
          callActive={circle.callActive}
          inCall={circle.inCall}
          onCall={onCircleCall}
          onLeaveSession={backToLobby}
        />
      )}
      {showCall && lobby && (
        <VideoCallOverlay
          sessionCode={lobby.sessionCode}
          endsAt={circle.callEndsAt}
          localStream={circle.localStream}
          localName={lobby.name}
          remotes={circle.remotes}
          muted={circle.muted}
          cameraOn={circle.cameraOn}
          joining={circle.joining}
          error={circle.callError}
          onToggleMute={circle.toggleMute}
          onToggleCamera={circle.toggleCamera}
          onLeave={closeCall}
        />
      )}
    </>
  )
}
