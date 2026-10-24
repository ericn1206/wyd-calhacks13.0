import React, { useEffect, useRef, useState } from 'react'
import type { RemoteTile } from './useCircleCall'

interface VideoCallProps {
  sessionCode: string
  endsAt: number | null
  localStream: MediaStream | null
  localName: string
  remotes: RemoteTile[]
  muted: boolean
  cameraOn: boolean
  joining: boolean
  error: string
  onToggleMute: () => void
  onToggleCamera: () => void
  onLeave: () => void
}

function StreamVideo({ stream, muted, mirror }: { stream: MediaStream; muted?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => undefined)
    return () => {
      el.srcObject = null
    }
  }, [stream])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
        background: '#111',
      }}
    />
  )
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const mins = Math.floor(seconds / 60)
  const rest = seconds % 60
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{mins}:{rest.toString().padStart(2, '0')}</span>
}

function connectionLabel(state: RTCPeerConnectionState): string {
  if (state === 'connected') return ''
  if (state === 'failed') return 'No route for video'
  if (state === 'disconnected') return 'Reconnecting…'
  return 'Connecting…'
}

function Tile({ name, stream, connection, muted, mirror, cameraOff }: {
  name: string
  stream: MediaStream | null
  connection?: RTCPeerConnectionState
  muted?: boolean
  mirror?: boolean
  cameraOff?: boolean
}) {
  const label = connection ? connectionLabel(connection) : ''
  return (
    <div style={{
      position: 'relative',
      height: '100%',
      minHeight: 0,
      borderRadius: 16,
      overflow: 'hidden',
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
    }}>
      {stream && !cameraOff ? <StreamVideo stream={stream} muted={muted} mirror={mirror} /> : (
        <div style={{
          height: '100%',
          minHeight: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#a5b4fc',
          fontSize: 28,
          fontWeight: 700,
        }}>
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div style={{
        position: 'absolute',
        left: 10,
        bottom: 10,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.55)',
          color: '#f5f5f5',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 600,
        }}>
          {name}
        </span>
        {label && (
          <span style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fdba74',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 12,
          }}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}

export function VideoCallOverlay({
  sessionCode,
  endsAt,
  localStream,
  localName,
  remotes,
  muted,
  cameraOn,
  joining,
  error,
  onToggleMute,
  onToggleCamera,
  onLeave,
}: VideoCallProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLeave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onLeave])

  const tiles = 1 + remotes.length
  const columns = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: '#0c0c0f',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: '1px solid #1f1f1f',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ color: '#f5f5f5', fontWeight: 700, fontSize: 14 }}>Circle check-in</span>
          <span style={{ color: '#6b7280', fontSize: 12, letterSpacing: 1 }}>{sessionCode}</span>
        </div>
        <div style={{ color: '#a5b4fc', fontSize: 13, fontWeight: 600 }}>
          {endsAt ? <Countdown endsAt={endsAt} /> : 'Joining'}
          <span style={{ color: '#4b5563', fontWeight: 500, marginLeft: 8 }}>ends on its own</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        {error ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
            <p style={{ color: '#fdba74', textAlign: 'center', maxWidth: 380, margin: 0, lineHeight: 1.5 }}>{error}</p>
            <button onClick={onLeave} style={ghostButton}>Close</button>
          </div>
        ) : (
          <div style={{
            height: '100%',
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridAutoRows: '1fr',
            gap: 10,
          }}>
            <Tile
              name={`${localName} (you)`}
              stream={localStream}
              muted
              mirror
              cameraOff={!cameraOn}
              connection={joining && !localStream ? 'connecting' : undefined}
            />
            {remotes.map((remote) => (
              <Tile
                key={remote.peerId}
                name={remote.name}
                stream={remote.stream}
                connection={remote.stream ? remote.connection : 'connecting'}
              />
            ))}
            {remotes.length === 0 && !joining && (
              <div style={{
                borderRadius: 16,
                border: '1px dashed #2a2a2a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                padding: 24,
                textAlign: 'center',
              }}>
                Waiting for the rest of your circle…
              </div>
            )}
          </div>
        )}
      </div>

      {!error && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 10,
          padding: '12px 16px 18px',
          flexShrink: 0,
        }}>
          <button onClick={onToggleMute} style={controlButton(muted)}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button onClick={onToggleCamera} style={controlButton(!cameraOn)}>
            {cameraOn ? 'Camera off' : 'Camera on'}
          </button>
          <button onClick={onLeave} style={{ ...controlButton(true), background: '#7f1d1d', color: '#fecaca' }}>
            Leave
          </button>
        </div>
      )}
    </div>
  )
}

const ghostButton: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#374151',
  color: '#f5f5f5',
  cursor: 'pointer',
  fontSize: 13,
}

function controlButton(active: boolean): React.CSSProperties {
  return {
    padding: '10px 16px',
    borderRadius: 999,
    border: 'none',
    background: active ? '#3f3f46' : '#27272a',
    color: '#f5f5f5',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    minWidth: 96,
  }
}
