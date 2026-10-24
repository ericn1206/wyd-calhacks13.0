import React, { useState, useEffect, useRef } from 'react'
import type { ActivityState, ActivityEntry } from '../../main/activityMonitor'
import type { SessionContext } from '../../main/claudeJudge'
import type { OnboardingPhase } from '../../main/sessionManager'

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

function LandingScreen({ onStart }: { onStart: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 24, padding: 40
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f5f5f5', margin: 0 }}>Lock In</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: 0, textAlign: 'center', maxWidth: 320 }}>
        Start a session and tell the AI what you're working on. It'll keep you honest.
      </p>
      <button onClick={onStart} style={{
        marginTop: 8, padding: '14px 40px', borderRadius: 12, border: 'none',
        background: '#6366f1', color: '#fff', fontSize: 16, fontWeight: 700,
        cursor: 'pointer'
      }}>
        Start Session
      </button>
    </div>
  )
}

function OnboardingScreen({ phase, onTranscript }: {
  phase: OnboardingPhase
  onTranscript: (t: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef<any>(null)

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not available in this browser.'); return }
    const r = new SR()
    r.continuous = false
    r.interimResults = true
    r.onresult = (e: any) => {
      const t = Array.from(e.results as any[]).map((res: any) => res[0].transcript).join('')
      setTranscript(t)
    }
    r.onend = () => setListening(false)
    r.start()
    recognitionRef.current = r
    setListening(true)
    setTranscript('')
  }

  const submit = () => {
    recognitionRef.current?.stop()
    if (transcript.trim()) onTranscript(transcript.trim())
  }

  if (phase === 'speaking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 40 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              width: 6, borderRadius: 3,
              background: '#6366f1',
              animation: `wave 1s ease-in-out ${i * 0.1}s infinite alternate`,
              height: `${20 + i * 5}px`
            }} />
          ))}
        </div>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>AI is speaking...</p>
      </div>
    )
  }

  if (phase === 'processing') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Setting up your session...</p>
      </div>
    )
  }

  // phase === 'listening'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 24, padding: 40 }}>
      <p style={{ color: '#f5f5f5', fontSize: 18, fontWeight: 600, textAlign: 'center', maxWidth: 400, margin: 0 }}>
        What are you working on today?
      </p>
      <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', maxWidth: 360, margin: 0 }}>
        Tell me your subject and goals — the AI will use this to judge what counts as productive for you.
      </p>

      <button onClick={startListening} disabled={listening} style={{
        width: 72, height: 72, borderRadius: '50%', border: 'none',
        background: listening ? '#ef4444' : '#6366f1',
        color: '#fff', fontSize: 28, cursor: 'pointer',
        boxShadow: listening ? '0 0 0 8px #ef444422' : 'none',
        transition: 'all 0.2s'
      }}>
        🎤
      </button>

      {transcript && (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '12px 16px', maxWidth: 400, width: '100%' }}>
          <p style={{ color: '#d1d5db', margin: 0, fontSize: 14, lineHeight: 1.5 }}>{transcript}</p>
        </div>
      )}

      {transcript && (
        <button onClick={submit} style={{
          padding: '10px 32px', borderRadius: 10, border: 'none',
          background: '#22c55e', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer'
        }}>
          Lock In
        </button>
      )}

      <p style={{ color: '#4b5563', fontSize: 12, margin: 0 }}>
        {listening ? 'Listening... click mic to stop' : 'Click the mic to speak'}
      </p>
    </div>
  )
}

// ── Active Dashboard ────────────────────────────────────────────────────────

const defaultState: ActivityState = {
  appName: 'Loading...', windowTitle: '', category: 'unknown', reason: '',
  judgedByClaude: false, consecutiveDistractedSeconds: 0, alertLevel: 'none',
  sessionStartTime: Date.now(), sessionContext: null, history: [], activity: { app: 'Unknown', title: '', category: 'unknown' }
}

function Dashboard({ state }: { state: ActivityState }) {
  const color = COLORS[state.category]
  const showTimer = state.consecutiveDistractedSeconds > 0
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
      </div>

      {/* Session context pill */}
      {state.sessionContext && (
        <div style={{
          background: '#1a1a2e', border: '1px solid #6366f133', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: 16 }}>🎯</span>
          <div>
            <div style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 13 }}>{state.sessionContext.subject}</div>
            {state.sessionContext.goals.length > 0 && (
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                {state.sessionContext.goals.join(' · ')}
              </div>
            )}
          </div>
          {state.judgedByClaude && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6366f1', background: '#6366f111', padding: '2px 8px', borderRadius: 999 }}>
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
            Sustained distraction detected — your group would be notified
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

  useEffect(() => {
    window.activityAPI.onUpdate(setActivityState)
    window.sessionAPI.onPhase(phase => {
      if (phase === 'done') {
        setAppPhase('active')
      } else {
        setAppPhase(phase)
      }
    })
    window.sessionAPI.onContextReady(() => setAppPhase('active'))
    return () => {
      window.activityAPI.removeAllListeners()
      window.sessionAPI.removeAllListeners()
    }
  }, [])

  const handleStart = () => {
    setAppPhase('speaking')
    window.sessionAPI.start()
  }

  const handleTranscript = (t: string) => {
    setAppPhase('processing')
    window.sessionAPI.submitResponse(t)
  }

  if (appPhase === 'landing') return <LandingScreen onStart={handleStart} />
  if (appPhase === 'active') return <Dashboard state={activityState} />
  return <OnboardingScreen phase={appPhase as OnboardingPhase} onTranscript={handleTranscript} />
}
