import type { ActivityCategory, FocusEvent, Signals, Status } from './types.ts'

export interface Fixture {
  name: string
  topic: string
  phase: 'work' | 'break'
  events: FocusEvent[]
  expect: Status
}

const START = Date.parse('2026-10-24T01:10:00Z')
const FOCUSED: Signals = { eyes: 'open', posture: 'upright', lookingAway: false, phoneVisible: false, phoneInUse: false }

// One sample every 10 s from `from` to `to` seconds, like the desktop poller would send.
function block(
  from: number, to: number, app: string, title: string, category: ActivityCategory,
  signals: Partial<Signals> = {}
): FocusEvent[] {
  const out: FocusEvent[] = []
  for (let t = from; t < to; t += 10) {
    out.push({
      user: 'jake',
      session: 'abc123',
      time: new Date(START + t * 1000).toISOString(),
      signals: { ...FOCUSED, ...signals },
      activity: { app, title, category }
    })
  }
  return out
}

const JAVA = 'CS 61B project 1: linked list deque in Java'
const ALGOS = 'CS 170: heaps and priority queues'

export const FIXTURES: Fixture[] = [
  // --- clear cases ---
  {
    name: 'VS Code on the project',
    topic: JAVA, phase: 'work', expect: 'on_task',
    events: block(0, 120, 'Code', 'LinkedListDeque.java — proj1', 'coding')
  },
  {
    name: 'Instagram for 2 minutes',
    topic: JAVA, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Google Chrome', 'Instagram', 'social')
  },
  {
    name: 'Netflix',
    topic: ALGOS, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Google Chrome', 'Stranger Things | Netflix', 'video')
  },
  {
    name: 'Submitting on Gradescope',
    topic: JAVA, phase: 'work', expect: 'on_task',
    events: [
      ...block(0, 60, 'Code', 'LinkedListDeque.java — proj1', 'coding'),
      ...block(60, 120, 'Google Chrome', 'Project 1 | Gradescope', 'school')
    ]
  },
  {
    name: 'Notion notes on the topic',
    topic: ALGOS, phase: 'work', expect: 'on_task',
    events: block(0, 120, 'Notion', 'Lecture 9 — Binary heaps', 'notes')
  },
  {
    name: 'Quick Spotify skip mid-coding',
    topic: JAVA, phase: 'work', expect: 'on_task',
    events: [
      ...block(0, 60, 'Code', 'LinkedListDeque.java — proj1', 'coding'),
      ...block(60, 70, 'Spotify', 'lofi hip hop radio', 'music'),
      ...block(70, 120, 'Code', 'LinkedListDeque.java — proj1', 'coding')
    ]
  },
  {
    name: 'Docs open, eyes closed and slouched',
    topic: ALGOS, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Google Chrome', 'Heaps study guide - Google Docs', 'docs', { eyes: 'closed', posture: 'slouched' })
  },
  // --- tricky cases ---
  {
    name: 'YouTube lecture on the topic',
    topic: ALGOS, phase: 'work', expect: 'on_task',
    events: block(0, 120, 'Google Chrome', 'MIT 6.006 Lecture 4: Heaps and Heap Sort - YouTube', 'unknown')
  },
  {
    name: 'YouTube music video',
    topic: ALGOS, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Google Chrome', 'Doja Cat - Paint The Town Red (Official Video) - YouTube', 'unknown')
  },
  {
    name: 'Discord study group',
    topic: JAVA, phase: 'work', expect: 'on_task',
    events: [
      ...block(0, 60, 'Discord', '#61b-proj1-help | CS 61B Study Group', 'chat'),
      ...block(60, 120, 'Code', 'LinkedListDeque.java — proj1', 'coding')
    ]
  },
  {
    name: 'Discord memes channel',
    topic: JAVA, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Discord', '#memes | gaming friends', 'chat')
  },
  {
    name: 'Phone in hand with notes open',
    topic: ALGOS, phase: 'work', expect: 'off_task',
    events: [
      ...block(0, 30, 'Notability', 'CS170 — heaps', 'notes'),
      ...block(30, 120, 'Notability', 'CS170 — heaps', 'notes', { lookingAway: true, phoneVisible: true, phoneInUse: true })
    ]
  },
  {
    name: 'Reddit post about the topic',
    topic: JAVA, phase: 'work', expect: 'on_task',
    events: [
      ...block(0, 50, 'Google Chrome', 'How do circular sentinel deques work? : r/learnjava', 'social'),
      ...block(50, 120, 'Code', 'LinkedListDeque.java — proj1', 'coding')
    ]
  },
  {
    name: 'Docs open, looking away the whole time',
    topic: ALGOS, phase: 'work', expect: 'off_task',
    events: block(0, 120, 'Google Chrome', 'Heaps study guide - Google Docs', 'docs', { lookingAway: true })
  },
  {
    name: 'Instagram during the Pomodoro break',
    topic: JAVA, phase: 'break', expect: 'break',
    events: block(0, 120, 'Google Chrome', 'Instagram', 'social')
  }
]

// Extra titles the desktop rules leave as 'unknown', for the categorizer.
export const UNKNOWN_TITLES: { app: string; title: string }[] = [
  { app: 'Google Chrome', title: 'Binary heap - Wikipedia' },
  { app: 'Google Chrome', title: 'ChatGPT' },
  { app: 'Safari', title: 'Heap Sort | Khan Academy' },
  { app: 'Google Chrome', title: 'MrBeast - I Survived 50 Hours In Antarctica - YouTube' },
  { app: 'Arc', title: 'Amazon.com: mechanical keyboard' },
  { app: 'Steam', title: 'Steam' },
  { app: 'Preview', title: 'cs170-hw4.pdf' },
  { app: 'Zoom', title: 'Zoom Meeting' }
]
