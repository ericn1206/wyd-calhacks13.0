import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'
import { BreakRoom } from './BreakRoom'

type Props = {
  minutes: number
  seconds: number
  goals: string[]
  checked: boolean[]
  setChecked: (checked: boolean[]) => void
  /** Demo flow only. In a session the server ends the break, so omit it. */
  onReturn?: () => void
  /** Host of a session: end it for everyone. */
  onEnd?: () => void
  /** In a database session: join the session's break video room. */
  room?: { sessionCode: string; name: string }
}

export function BreakScreen({ minutes, seconds, goals, checked, setChecked, onReturn, onEnd, room }: Props) {
  return <Shell><div className="break-layout"><div className="break-hero"><div className="icon-bubble mint"><Icon name="sparkle" /></div><div className="eyebrow">Pomodoro complete</div><h1>{minutes === 5 ? 'Nice work. Take five.' : `Nice work. Take ${minutes}.`}</h1><p className="lead">Step away, stretch, or grab some water. You earned it.</p><div className="break-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>{onReturn ? <button className="primary" onClick={onReturn}>Back to focus <Icon name="arrow" /></button> : <p className="hint">The next round starts automatically for everyone.</p>}{onEnd && <button className="secondary" onClick={onEnd}>End session for everyone</button>}</div>{room ? <BreakRoom sessionCode={room.sessionCode} name={room.name} seconds={seconds} /> : <div className="card check-card"><p className="eyebrow">Quick goal check</p><h3>What did you make progress on?</h3><div className="check-list">{goals.map((goal, i) => <label key={goal}><input type="checkbox" checked={checked[i]} onChange={() => setChecked(checked.map((v, j) => j === i ? !v : v))} /><span className="fake-check"><Icon name="check" /></span><span>{goal}</span></label>)}</div><small>You can keep unfinished goals for the next round.</small></div>}</div></Shell>
}
