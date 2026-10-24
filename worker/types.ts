// Mirrors the shared event format in docs/architecture/contracts.md — do not change without telling the team.

export type ActivityCategory =
  | 'coding' | 'notes' | 'docs' | 'school' | 'chat'
  | 'social' | 'video' | 'music' | 'unknown'

export const CATEGORIES: ActivityCategory[] = [
  'coding', 'notes', 'docs', 'school', 'chat', 'social', 'video', 'music', 'unknown'
]

export type Status = 'on_task' | 'off_task' | 'break'

export const STATUSES: Status[] = ['on_task', 'off_task', 'break']

export interface Signals {
  eyes: 'open' | 'closed'
  posture: 'upright' | 'slouched'
  lookingAway: boolean
  phoneVisible: boolean
  phoneInUse: boolean
}

export interface Activity {
  app: string
  title: string
  category: ActivityCategory
}

export interface FocusEvent {
  user: string
  session: string
  time: string // ISO 8601
  signals: Signals
  activity: Activity
  status?: Status
  confidence?: number
  reason?: string
}

export interface Judgment {
  status: Status
  confidence: number
  reason: string
}
