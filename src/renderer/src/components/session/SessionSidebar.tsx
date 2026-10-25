import type { Person } from '../../data/people'
import { Icon } from '../ui/Icon'

/** `Person.status` → [badge, subtitle]. */
const STATUS_TEXT: Record<string, [string, string]> = {
  focused: ['Focused', 'Focused'],
  drifting: ['Drifting', 'Drifting a little'],
  resting: ['Resting', 'On a break'],
  idle: ['Idle', 'Getting started']
}

export function SessionSidebar({ sessionName, role, goals, checked, setChecked, people }: { sessionName: string; role: 'Host' | 'Participant'; goals: string[]; checked: boolean[]; setChecked: (checked: boolean[]) => void; people: Person[] }) {
  return <aside><div className="session-context"><span className="brand-mark">W</span><div><small>Current session</small><strong>{sessionName}</strong></div><em>{role}</em></div><div className="card goals-side"><div className="side-title"><span><Icon name="target" />Your goals</span><em>{checked.filter(Boolean).length}/{goals.length}</em></div>{goals.map((goal, i) => <label key={goal}><input type="checkbox" checked={checked[i]} onChange={() => setChecked(checked.map((v, j) => i === j ? !v : v))} /><span className="fake-check"><Icon name="check" /></span><span>{goal}</span></label>)}</div><div className="card team-side"><div className="side-title"><span><Icon name="users" />Studying with you</span></div>{people.map((p) => <div className="person" key={p.name + p.initials}><span className={`avatar ${p.color}`} style={p.hex ? { background: p.hex } : undefined}>{p.initials}<i className={p.status} /></span><p><strong>{p.name}</strong><small>{STATUS_TEXT[p.status]?.[1] ?? 'Idle'}</small></p><span className={`status-text ${p.status}`}>{STATUS_TEXT[p.status]?.[0] ?? 'Idle'}</span></div>)}</div></aside>
}
