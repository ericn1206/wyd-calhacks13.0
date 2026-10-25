import { people } from '../../data/people'
import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

type Props = {
  error?: string
  busy?: boolean
  mode: 'join' | 'create'
  setMode: (mode: 'join' | 'create') => void
  code: string
  setCode: (code: string) => void
  sessionName: string
  setSessionName: (name: string) => void
  codeCopied: boolean
  copyCode: () => void
  continueSetup: () => void
  displayName: string
  setDisplayName: (name: string) => void
}

export function EntryScreen({ error, busy, mode, setMode, code, setCode, sessionName, setSessionName, codeCopied, copyCode, continueSetup, displayName, setDisplayName }: Props) {
  return <Shell step={1}><div className="intro-card card">
    <div className="entry-switch" role="tablist" aria-label="Session action"><button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')} role="tab" aria-selected={mode === 'join'}>Join a session</button><button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')} role="tab" aria-selected={mode === 'create'}>Create a session</button></div>
    <label className="field-label" htmlFor="display-name">Your name</label><input id="display-name" className="session-name-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How teammates see you" maxLength={40} />
    {/* Both panels share one grid cell so the card keeps the taller height when switching tabs. */}
    <div className="entry-panels"><div className="entry-panel join-panel" aria-hidden={mode !== 'join'}><div><div className="eyebrow">Focus is better together</div><h1>What are you doing?</h1><p className="lead">Join your study group, set your intentions, and stay gently accountable.</p></div><div><label className="field-label" htmlFor="code">Session code</label><div className="code-row"><input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter code" maxLength={10} /><button className="primary square" disabled={busy} onClick={() => code.trim() && continueSetup()} aria-label="Join session"><Icon name="arrow" /></button></div><p className="hint">Ask your group host for the code</p></div><div className="group-preview"><div className="avatar-stack">{people.map((p) => <span key={p.name} className={`avatar mini ${p.color}`}>{p.initials}</span>)}</div><div><strong>Study group found</strong><span>Chapter Six Study Crew</span></div></div></div><div className="entry-panel" aria-hidden={mode !== 'create'}><div className="eyebrow">Start a focus room</div><h1>Bring your crew together.</h1><p className="lead">Create a session, share the invite code, and begin when everyone is ready.</p><label className="field-label" htmlFor="session-name">Session name</label><input id="session-name" className="session-name-input" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Name your study session" /><div className="invite-code"><div><small>Your invite code</small><strong>{code}</strong></div><button className="secondary" onClick={copyCode}>{codeCopied ? <><Icon name="check" />Copied</> : 'Copy code'}</button></div><p className="hint">You can invite teammates after creating the room.</p><button className="primary full create-session-button" disabled={!sessionName.trim() || busy} onClick={continueSetup}>{busy ? 'Creating…' : 'Create session'} <Icon name="arrow" /></button></div></div>
    {error && <p className="hint" role="alert" style={{ color: '#c0463a' }}>{error}</p>}
  </div></Shell>
}
