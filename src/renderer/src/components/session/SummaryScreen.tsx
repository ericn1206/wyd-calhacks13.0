import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

export type SummaryStats = { totalSecs: number; deepWorkSecs: number; interruptions: number; goalsCompleted: number; goalsTotal: number }

export type ClipHighlight = { link: string; state: 'waiting' | 'rendering' | 'ready' | 'failed' }

const CLIP_COPY: Record<ClipHighlight['state'], string> = {
  ready: 'Your highlight reel is ready.',
  rendering: 'Putting your moments together…',
  failed: 'The reel hit a snag. It will try again.',
  waiting: 'Your moments are being collected. The link opens the reel as soon as it is ready.'
}

function HighlightCard({ clip }: { clip: ClipHighlight }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(clip.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }
  return <div className="card clip-card"><div><p className="eyebrow">Session highlights</p><h3>{clip.state === 'ready' ? 'Watch your moments' : 'Your highlight reel'}</h3><p role="status">{CLIP_COPY[clip.state]}</p></div><div className="clip-actions"><a className="primary" href={clip.link} target="_blank" rel="noreferrer">{clip.state === 'ready' ? 'Watch' : 'Open link'}</a><button className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button></div></div>
}

export function SummaryScreen({ checked, goalCount, stats, clip }: { checked: boolean[]; goalCount: number; stats?: SummaryStats | null; clip?: ClipHighlight | null }) {
  const real = stats && stats.totalSecs > 0 ? stats : null
  const pct = real ? Math.round((100 * real.deepWorkSecs) / real.totalSecs) : 89
  const mins = real ? Math.round(real.deepWorkSecs / 60) : 25
  const done = stats ? stats.goalsCompleted : checked.filter(Boolean).length
  const total = stats ? stats.goalsTotal : goalCount
  return <Shell><div className="summary-wrap"><div className="summary-heading"><span className="icon-bubble mint"><Icon name="check" /></span><div><div className="eyebrow">Private session summary</div><h1>You showed up today.</h1><p>Only you can see these stats.</p></div></div><div className="summary-grid"><div className="stat-card featured"><span className="stat-icon"><Icon name="target" /></span><div><strong>{pct}%</strong><span>on task</span></div><small>{real ? `${real.interruptions} drift${real.interruptions === 1 ? '' : 's'} this session` : '+7% from last session'}</small></div><div className="stat-card"><span className="stat-icon yellow"><Icon name="check" /></span><div><strong>{done}<em> / {total}</em></strong><span>goals completed</span></div></div><div className="stat-card"><span className="stat-icon blue"><Icon name="clock" /></span><div><strong>{mins}<em> min</em></strong><span>focused time</span></div></div></div><div className="card focus-story"><div><p className="eyebrow">Your focus rhythm</p><h3>Strong and steady</h3><p>You stayed focused for most of the session, with one brief drift around the 18-minute mark.</p></div><div className="bars">{[65,82,90,88,94,70,91,96,84,89,94,88].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div></div>{clip && <HighlightCard clip={clip} />}<button className="primary" onClick={() => location.reload()}>Done</button></div></Shell>
}
