import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

type Props = {
  minutes: number
  seconds: number
  goals: string[]
  checked: boolean[]
  setChecked: (checked: boolean[]) => void
  onReturn: () => void
}

export function BreakScreen({ minutes, seconds, goals, checked, setChecked, onReturn }: Props) {
  return <Shell><div className="break-layout"><div className="break-hero"><div className="icon-bubble mint"><Icon name="sparkle" /></div><div className="eyebrow">{minutes >= 20 ? 'Four rounds complete' : 'Pomodoro complete'}</div><h1>{minutes >= 20 ? 'Time for a longer reset.' : 'Nice work. Take five.'}</h1><p className="lead">{minutes >= 20 ? 'Your brain is consolidating what you learned. Fully step away for a while.' : 'Step away, stretch, or grab some water. You earned it.'}</p><div className="break-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div><button className="primary" onClick={onReturn}>Back to focus <Icon name="arrow" /></button></div><div className="card check-card"><p className="eyebrow">Quick goal check</p><h3>What did you make progress on?</h3><div className="check-list">{goals.map((goal, i) => <label key={goal}><input type="checkbox" checked={checked[i]} onChange={() => setChecked(checked.map((v, j) => j === i ? !v : v))} /><span className="fake-check"><Icon name="check" /></span><span>{goal}</span></label>)}</div><small>You can keep unfinished goals for the next round.</small></div></div></Shell>
}
