import { useEffect, useRef } from 'react'
import { useCircleCall } from '../../useCircleCall'

function Tile({ name, stream, mirror }: { name: string; stream: MediaStream | null; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play().catch(() => undefined)
    return () => { el.srcObject = null }
  }, [stream])
  return <div className={`break-tile${mirror ? ' mirror' : ''}`}><video ref={ref} autoPlay playsInline muted={mirror} /><span>{name}</span></div>
}

/** Bare-bones break room: joins the session's break LiveKit room as soon as it mounts and shows everyone's video. */
export function BreakRoom({ sessionCode, name, seconds }: { sessionCode: string; name: string; seconds: number }) {
  const circle = useCircleCall({ name, sessionCode, kind: 'break' })
  const secondsRef = useRef(seconds)
  secondsRef.current = seconds
  const connected = circle.status === 'connected'
  useEffect(() => {
    // Each laptop starts its own window for the remaining break; startCall joins if one is already running.
    if (connected) circle.startCall({ durationMs: Math.max(5, secondsRef.current) * 1000 })
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="break-room">
      <div className="break-videos">
        {circle.localStream && <Tile name={`${name} (you)`} stream={circle.localStream} mirror />}
        {circle.remotes.map((tile) => <Tile key={tile.peerId} name={tile.name} stream={tile.stream} />)}
      </div>
      {(circle.callError || circle.error) && <small className="hint">{circle.callError || circle.error}</small>}
    </div>
  )
}
