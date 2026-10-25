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
  const peerCount = circle.peers.length
  useEffect(() => {
    // Alone in the room: no camera, no mic, nothing shown. Media starts once a teammate is connected
    // and stops again if everyone else leaves.
    if (!connected) return
    if (peerCount > 0) circle.startCall({ durationMs: Math.max(5, secondsRef.current) * 1000 })
    else if (circle.inCall) circle.leaveCall()
  }, [connected, peerCount]) // eslint-disable-line react-hooks/exhaustive-deps

  if (peerCount === 0) return null

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
