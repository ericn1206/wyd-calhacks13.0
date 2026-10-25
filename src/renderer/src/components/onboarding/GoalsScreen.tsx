import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

export function GoalsScreen({ task, setTask, onStart }: { task: string; setTask: (t: string) => void; onStart: () => void }) {
  return <Shell step={2}><div className="card goals-card"><div className="icon-bubble yellow"><Icon name="target" /></div><h2>What are you working on?</h2><input className="session-name-input" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && task.trim() && onStart()} placeholder="e.g. Finish chapter 6 notes" autoFocus /><button className="primary full" disabled={!task.trim()} onClick={onStart}>Start focusing <Icon name="arrow" /></button></div></Shell>
}
