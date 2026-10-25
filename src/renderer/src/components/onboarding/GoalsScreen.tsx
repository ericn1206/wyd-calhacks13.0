import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

export function GoalsScreen({ task, setTask, onStart }: { task: string; setTask: (task: string) => void; onStart: () => void }) {
  const ready = task.trim().length > 0
  return (
    <Shell step={3}>
      <div className="card goals-card">
        <div className="icon-bubble yellow"><Icon name="target" /></div>
        <h2>What do you want to do?</h2>
        <input className="session-name-input" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ready && onStart()} placeholder="e.g. Study chemistry" autoFocus />
        <button className="primary full" disabled={!ready} onClick={onStart}>Start focusing <Icon name="arrow" /></button>
      </div>
    </Shell>
  )
}
