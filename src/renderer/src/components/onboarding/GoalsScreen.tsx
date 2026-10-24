import { Icon } from '../ui/Icon'
import { Shell } from '../ui/Shell'

export function GoalsScreen({ goals, setGoals, onStart }: { goals: string[]; setGoals: (goals: string[]) => void; onStart: () => void }) {
  const activeGoals = goals.filter((goal) => goal.trim())
  return <Shell step={3}><div className="card goals-card"><div className="icon-bubble yellow"><Icon name="target" /></div><h2>What will you get done?</h2><p className="lead">Choose 2–3 clear goals for this focus session.</p><div className="goal-fields">{goals.map((goal, i) => <div className="goal-input" key={i}><span>{i + 1}</span><input value={goal} onChange={(e) => setGoals(goals.map((g, j) => j === i ? e.target.value : g))} placeholder={i === 2 ? 'Add an optional goal' : 'Type a session goal'} /></div>)}</div><div className="tip"><Icon name="sparkle" /><span><strong>Make it achievable</strong>“Outline two sections” works better than “write essay.”</span></div><button className="primary full" disabled={activeGoals.length < 2} onClick={onStart}>Start focusing <Icon name="arrow" /></button></div></Shell>
}
