import { useEffect, useRef } from 'react'
import type { RemoteTile } from '../../useCircleCall'
import { Icon } from '../ui/Icon'

const FOCUS_LABEL: Record<string, string> = {
  focused: 'Focused',
  away: 'Looking away',
  noface: 'No face',
  off: 'Detector off',
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
  return <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : undefined} />
}

function Tile({ name, stream, focus, mirror }: { name: string; stream: MediaStream | null; focus: string; mirror?: boolean }) {
  return <div className="live-tile">
    {stream ? <StreamVideo stream={stream} muted={mirror} mirror={mirror} /> : <span className="live-initial">{name.slice(0, 1).toUpperCase()}</span>}
    <div className="live-tile-labels"><span>{name}</span><span className={`live-focus ${focus}`}>{FOCUS_LABEL[focus] ?? FOCUS_LABEL.off}</span></div>
  </div>
}

/** Demo-only live view of everyone's camera (LOCKIN_DEMO=1). Video only; audio stays in calls. */
export function LiveGrid({ localName, localStream, localFocus, remotes, error, onHide, onTurnOff }: {
  localName: string
  localStream: MediaStream | null
  localFocus: string
  remotes: RemoteTile[]
  error: string
  onHide: () => void
  onTurnOff: () => void
}) {
  const tiles = 1 + remotes.length
  const columns = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3
  return <div className="overlay"><div className="live-grid card">
    <div className="live-grid-head">
      <span className="live-dot" />
      <div><strong>Live circle view</strong><small>Everyone’s camera, with their webcam focus status</small></div>
      <button className="secondary" onClick={onHide}>Hide</button>
      <button className="primary" onClick={onTurnOff}><Icon name="x" />Turn off for everyone</button>
    </div>
    {error && <p className="live-error">{error}</p>}
    <div className="live-tiles" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      <Tile name={`${localName} (you)`} stream={localStream} focus={localFocus} mirror />
      {remotes.map((remote) => <Tile key={remote.peerId} name={remote.name} stream={remote.stream} focus={remote.focus} />)}
    </div>
    {remotes.length === 0 && <p className="hint">Waiting for the rest of your circle…</p>}
  </div></div>
}

/** Shown on every laptop while live view is on, so nobody is shared without knowing. */
export function LiveBanner({ gridHidden, onShow }: { gridHidden: boolean; onShow: () => void }) {
  return <div className="live-banner"><span className="live-dot" />LIVE: your camera is shared with the circle{gridHidden && <button onClick={onShow}>Show</button>}</div>
}
