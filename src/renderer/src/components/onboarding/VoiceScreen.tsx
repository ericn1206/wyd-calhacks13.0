import { useCartesiaCall, type AgentCredentials } from '../../cartesiaCall'
import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

export type VoicePhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'

export function VoiceScreen({
  phase,
  creds,
  stream,
  error,
  onTranscript,
  onSettled,
  onTypeInstead,
}: {
  phase: VoicePhase
  creds: AgentCredentials | null
  stream: MediaStream | null
  error: string
  onTranscript: (text: string) => void
  onSettled: () => void
  onTypeInstead: () => void
}) {
  const call = useCartesiaCall(creds, stream, onTranscript, onSettled)
  const saving = phase === 'processing' || phase === 'done'
  const speaking = call.status === 'speaking'
  const line = error
    ? error
    : saving
      ? "Saving what you're studying…"
      : !creds
        ? 'Starting the voice interview…'
        : speaking
          ? 'Listen, then answer out loud.'
          : call.status === 'listening'
            ? "Your turn. Say what you're working on."
            : 'Connecting…'

  return (
    <Shell step={3}>
      <div className="card goals-card voice-card">
        <div className="icon-bubble mint"><Icon name="mic" /></div>
        <h2>What are you studying?</h2>
        <p className="lead">A short voice interview sets the context for this session. Answer out loud.</p>
        <div className={`voice-wave ${speaking ? 'speaking' : ''} ${call.status === 'listening' ? 'listening' : ''}`} aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => <span key={i} />)}
        </div>
        <p className="voice-status">{call.error || line}</p>
        {call.transcript.length > 0 && (
          <div className="voice-transcript">
            {call.transcript.map((turn) => (
              <p key={turn.id} className={turn.role}>
                <strong>{turn.role === 'user' ? 'You' : 'Voice'}</strong>
                {turn.text || '…'}
              </p>
            ))}
          </div>
        )}
        <button className="secondary full" type="button" onClick={onTypeInstead}>Type goals instead</button>
      </div>
    </Shell>
  )
}
