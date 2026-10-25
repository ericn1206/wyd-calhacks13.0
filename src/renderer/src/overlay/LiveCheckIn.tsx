import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/ui/Icon'
import type { Person } from '../data/people'
import { useCircleCall } from '../useCircleCall'

const PALETTE = ['bg-[#dbe9ff]', 'bg-[#f4ddff]', 'bg-[#ffdfd5]', 'bg-[#d9f2e5]']

function StreamVideo({ stream, muted }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => undefined)
    return () => { el.srcObject = null }
  }, [stream])

  return <video ref={ref} autoPlay playsInline muted={muted} />
}

function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0])
  return (letters.join('') || name.slice(0, 1) || '?').toUpperCase()
}

function CameraTile({ name, stream, mirror, cameraOff }: {
  name: string
  stream: MediaStream | null
  mirror?: boolean
  cameraOff?: boolean
}) {
  const hasLiveVideo = Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled))
  const showVideo = hasLiveVideo && !cameraOff
  return (
    <div className={`glass-video member-video${mirror ? ' mirror' : ''}`}>
      {showVideo && stream ? <StreamVideo stream={stream} muted={mirror} /> : (
        <div className="avatar bg-[#dbe9ff]">{initials(name)}</div>
      )}
      {!showVideo && <em>Connecting</em>}
      <span>{name}</span>
    </div>
  )
}

function Countdown({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  if (!endsAt) return <strong>··</strong>
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const mins = Math.floor(seconds / 60)
  const rest = seconds % 60
  return <strong>{mins}:{rest.toString().padStart(2, '0')}</strong>
}

const INVITE_SECONDS = 3 // Join prompt for a teammate's check-in; skipped when it runs out

/**
 * Real circle check-in. Joins the LiveKit room for this session code, and turns
 * cameras on when the distraction detector fires — or when someone else in the room does.
 */
export function LiveCheckIn({ sessionCode, displayName, corner, onActive, onLocalStart, onEnded, onRoster, onAlone, onInvite, joinInviteRef }: {
  sessionCode: string
  displayName: string
  corner: string
  onActive: (active: boolean) => void
  onLocalStart: () => void
  onEnded: () => void
  onRoster: (ready: boolean, people: Person[]) => void
  /** The detector fired but nobody else can join (no session room, or alone in it): show the duck window instead. */
  onAlone: () => void
  /** A teammate drifted: show the Join prompt under the dock (null hides it). */
  onInvite: (invite: { name: string; seconds: number } | null) => void
  /** Filled with the Join action for the dock's prompt. */
  joinInviteRef: { current: () => void }
}) {
  const room = sessionCode.length >= 4 ? { name: displayName, sessionCode } : null
  // Teammates' calls are invites, not auto-joins: Join under the dock, or skip after 3 s.
  const circle = useCircleCall(room, { autoJoin: false })
  const startRef = useRef(circle.startCall)
  startRef.current = circle.startCall
  const pending = useRef(false)
  const [pulse, setPulse] = useState(0)
  const [notice, setNotice] = useState('')
  const wasLive = useRef(false)

  const live = circle.inCall || circle.joining

  // One invite per call (keyed by its end time); joined, skipped, or our own call → never prompt again.
  const handledCall = useRef<number | null>(null)
  const [invite, setInvite] = useState<{ endsAt: number; name: string; seconds: number } | null>(null)
  useEffect(() => {
    if (live && circle.callEndsAt) handledCall.current = circle.callEndsAt
  }, [live, circle.callEndsAt])
  useEffect(() => {
    const endsAt = circle.callEndsAt
    if (!circle.callActive || !endsAt || live || !circle.callFrom || handledCall.current === endsAt) {
      setInvite((current) => (current && (!circle.callActive || live || current.endsAt !== endsAt) ? null : current))
      return
    }
    setInvite((current) => (current?.endsAt === endsAt ? current : { endsAt, name: circle.callFrom ?? 'A teammate', seconds: INVITE_SECONDS }))
  }, [circle.callActive, circle.callEndsAt, circle.callFrom, live])
  useEffect(() => {
    if (!invite) return
    if (invite.seconds <= 0) {
      handledCall.current = invite.endsAt
      circle.declineCall()
      setInvite(null)
      return
    }
    const id = window.setTimeout(() => setInvite((current) => (current ? { ...current, seconds: current.seconds - 1 } : current)), 1000)
    return () => window.clearTimeout(id)
  }, [invite])
  useEffect(() => {
    onInvite(invite ? { name: invite.name, seconds: invite.seconds } : null)
  }, [invite?.name, invite?.seconds, invite === null, onInvite])
  joinInviteRef.current = () => {
    if (!invite) return
    handledCall.current = invite.endsAt
    setInvite(null)
    circle.joinCall()
  }
  const rosterKey = circle.peers.map((peer) => `${peer.peerId}:${peer.name}`).join('|')

  useEffect(() => {
    onRoster(circle.status !== 'idle', circle.peers.map((peer, index) => ({
      name: peer.name,
      initials: initials(peer.name),
      color: PALETTE[index % PALETTE.length],
      status: 'focused',
    })))
  }, [circle.status, rosterKey, onRoster])

  useEffect(() => {
    if (!window.circleAPI?.onFacetime) return
    return window.circleAPI.onFacetime(() => {
      pending.current = true
      setNotice('')
      setPulse((n) => n + 1)
    })
  }, [])

  useEffect(() => {
    if (!pending.current) return
    if (circle.inCall || circle.joining || circle.callActive) {
      pending.current = false
      return
    }
    if (!room) {
      pending.current = false
      onAlone()
      return
    }
    if (circle.status === 'error') {
      pending.current = false
      setNotice(circle.error || 'Could not start the check-in.')
      return
    }
    if (circle.status !== 'connected') return
    pending.current = false
    if (circle.peers.length === 0) {
      onAlone() // nobody to call: duck window, no camera
      return
    }
    onLocalStart()
    startRef.current()
  }, [pulse, sessionCode, displayName, circle.status, circle.error, circle.inCall, circle.joining, circle.callActive, onLocalStart, onAlone])

  // Don't wait silently on LiveKit: if the room hasn't connected shortly after a trigger, say why.
  useEffect(() => {
    if (!pulse) return
    const id = window.setTimeout(() => {
      if (!pending.current) return
      pending.current = false
      setNotice(circle.error || 'Could not reach the check-in call. Check your connection (VPN?) and try again.')
    }, 8000)
    return () => window.clearTimeout(id)
  }, [pulse])

  useEffect(() => {
    onActive(live)
    if (live) {
      wasLive.current = true
      return
    }
    if (!wasLive.current) return
    wasLive.current = false
    if (circle.callError) return
    onEnded()
  }, [live, circle.callError, onActive, onEnded])

  const tiles: Array<{ key: string; name: string; stream: MediaStream | null; mirror?: boolean; cameraOff?: boolean }> = []
  if (live) {
    const streams = new Map(circle.remotes.map((remote) => [remote.peerId, remote.stream]))
    tiles.push({ key: 'me', name: 'You', stream: circle.localStream, mirror: true, cameraOff: !circle.cameraOn && Boolean(circle.localStream) })
    for (const peer of circle.peers) {
      tiles.push({ key: peer.peerId, name: peer.name, stream: streams.get(peer.peerId) ?? null })
    }
  }

  if (!live && !notice && !circle.callError) return null

  return <>
    {live && (
      <div className="checkin-timer-pop">
        <Icon name="clock" />
        <Countdown endsAt={circle.callEndsAt} />
        <button type="button" onClick={() => circle.leaveCall()}>Leave</button>
      </div>
    )}
    <section className={`glass-checkin corner-${corner} self-glass`}>
      {tiles.map((tile) => <CameraTile key={tile.key} name={tile.name} stream={tile.stream} mirror={tile.mirror} cameraOff={tile.cameraOff} />)}
      {notice && (
        <div className="glass-video call-error">
          <span className="call-message">{notice}</span>
          <button className="close-video" style={{ opacity: 1, transform: 'none' }} onClick={() => setNotice('')} aria-label="Dismiss check-in error"><Icon name="x" /></button>
        </div>
      )}
    </section>
    {live && circle.callError && (
      <div className="return-prompt">
        <div><strong>Camera did not start</strong><p>{circle.callError}</p></div>
        <button className="primary" onClick={() => circle.dismissCallError()}>Close</button>
      </div>
    )}
  </>
}
