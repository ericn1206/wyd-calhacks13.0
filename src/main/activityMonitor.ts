import { exec } from 'child_process'
import { classify, Category } from './appClassifier'
import { judgeActivity, SessionContext } from './claudeJudge'
import { categorize, ActivityCategory } from './categorize'

export type { Category, ActivityCategory }

// Matches the `activity` field of the shared event format (see docs/architecture/contracts.md)
export interface Activity {
  app: string
  title: string
  category: ActivityCategory
}

export interface ActivityEntry {
  timestamp: number
  appName: string
  windowTitle: string
  url?: string
  category: Category
  reason: string
  activity: Activity
}

export interface ActivityState {
  appName: string
  windowTitle: string
  url?: string
  category: Category
  reason: string
  activity: Activity
  judgedByClaude: boolean
  consecutiveDistractedSeconds: number
  alertLevel: 'none' | 'warning' | 'alert'
  sessionStartTime: number
  sessionContext: SessionContext | null
  history: ActivityEntry[]
}

function runScript(script: string): Promise<string> {
  return new Promise(resolve => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err, stdout) => {
      resolve(err ? '' : stdout.trim())
    })
  })
}

const GET_ACTIVE_APP_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set windowTitle to ""
  try
    set windowTitle to name of first window of frontApp
  end try
  return appName & "|||" & windowTitle
end tell
`

async function getActiveApp(): Promise<{ appName: string; windowTitle: string }> {
  const result = await runScript(GET_ACTIVE_APP_SCRIPT)
  if (!result) return { appName: 'Unknown', windowTitle: '' }
  const parts = result.split('|||')
  return { appName: parts[0] || 'Unknown', windowTitle: parts[1] || '' }
}

async function getBrowserUrl(appName: string): Promise<string> {
  const lower = appName.toLowerCase()
  let script = ''

  if (lower.includes('google chrome') || lower.includes('chrome')) {
    script = `tell application "Google Chrome" to get URL of active tab of first window`
  } else if (lower.includes('safari')) {
    script = `tell application "Safari" to get URL of current tab of first window`
  } else if (lower.includes('arc')) {
    script = `tell application "Arc" to get URL of active tab of first window`
  } else if (lower.includes('brave')) {
    script = `tell application "Brave Browser" to get URL of active tab of first window`
  } else {
    return ''
  }

  return runScript(script)
}

const POLL_INTERVAL_MS = 2000
const CLAUDE_INTERVAL_MS = 8000

export class ActivityMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private state: ActivityState
  private listeners: Array<(state: ActivityState) => void> = []
  private sessionContext: SessionContext | null = null
  private lastJudgment: { category: Category; reason: string } | null = null
  private lastClaudeCallTime = 0
  private isJudging = false

  constructor() {
    this.state = {
      appName: 'Unknown',
      windowTitle: '',
      category: 'unknown',
      reason: '',
      activity: { app: 'Unknown', title: '', category: 'unknown' },
      judgedByClaude: false,
      consecutiveDistractedSeconds: 0,
      alertLevel: 'none',
      sessionStartTime: Date.now(),
      sessionContext: null,
      history: []
    }
  }

  setSessionContext(ctx: SessionContext): void {
    this.sessionContext = ctx
    this.lastJudgment = null
    this.lastClaudeCallTime = 0
    this.state = { ...this.state, sessionContext: ctx }
  }

  start(): void {
    if (this.intervalHandle) return
    this.poll()
    this.intervalHandle = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  onUpdate(listener: (state: ActivityState) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  getState(): ActivityState {
    return this.state
  }

  // TODO(session-resting): NOT IMPLEMENTED. Sessions alternate `working` / `resting`
  // (DB `current_phase` Work / Break, see docs/product/spec.md#session-phases).
  // While resting this method must not run any off-task check: skip the Claude judge,
  // reset `consecutiveDistractedSeconds` to 0, keep alertLevel 'none', and send no
  // `ingest_signal`. Add `setResting(resting: boolean)` here, call it from main/index.ts
  // on every DB phase change (stdb.onChange), and return early at the top of poll().
  // On resume to working, status starts again from Idle.
  private async poll(): Promise<void> {
    const { appName, windowTitle } = await getActiveApp()
    const url = await getBrowserUrl(appName)
    const activity: Activity = { app: appName, title: windowTitle, category: categorize(appName, windowTitle, url) }

    let category: Category
    let reason: string
    let judgedByClaude = false

    if (this.sessionContext) {
      const now = Date.now()
      const shouldCallClaude =
        !this.isJudging && now - this.lastClaudeCallTime >= CLAUDE_INTERVAL_MS

      if (shouldCallClaude) {
        this.isJudging = true
        this.lastClaudeCallTime = now
        try {
          const judgment = await judgeActivity(
            appName, windowTitle, url || undefined,
            this.state.history.slice(-5),
            this.sessionContext
          )
          this.lastJudgment = judgment
        } catch {
          // keep last judgment on error
        }
        this.isJudging = false
      }

      if (this.lastJudgment) {
        category = this.lastJudgment.category
        reason = this.lastJudgment.reason
        judgedByClaude = true
      } else {
        // fallback until first Claude call resolves
        const result = classify(appName, windowTitle, url || undefined)
        category = result.category
        reason = result.reason
      }
    } else {
      const result = classify(appName, windowTitle, url || undefined)
      category = result.category
      reason = result.reason
    }

    let consecutiveDistractedSeconds = this.state.consecutiveDistractedSeconds
    if (category === 'distracted') {
      consecutiveDistractedSeconds += POLL_INTERVAL_MS / 1000
    } else {
      consecutiveDistractedSeconds = 0
    }

    let alertLevel: ActivityState['alertLevel']
    if (consecutiveDistractedSeconds === 0) {
      alertLevel = 'none'
    } else if (consecutiveDistractedSeconds >= 60) {
      alertLevel = 'alert'
    } else if (consecutiveDistractedSeconds >= 30) {
      alertLevel = 'warning'
    } else {
      alertLevel = 'none'
    }

    const lastEntry = this.state.history[this.state.history.length - 1]
    const changed =
      !lastEntry ||
      lastEntry.appName !== appName ||
      lastEntry.url !== (url || undefined) ||
      lastEntry.windowTitle !== windowTitle

    const history = changed
      ? [
          ...this.state.history,
          { timestamp: Date.now(), appName, windowTitle, url: url || undefined, category, reason, activity }
        ].slice(-20)
      : this.state.history

    this.state = {
      appName,
      windowTitle,
      url: url || undefined,
      category,
      reason,
      activity,
      judgedByClaude,
      consecutiveDistractedSeconds,
      alertLevel,
      sessionStartTime: this.state.sessionStartTime,
      sessionContext: this.sessionContext,
      history
    }

    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}
