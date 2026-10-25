export type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

/** Main-window state the overlay window needs to draw the dock. Sent on every change. */
export type OverlayState = {
  host: boolean
  /** Database session phase (`Lobby`/`Active`/`Break`); null in the local demo flow. */
  serverPhase: string | null
  focusSeconds: number
  pomodoroMinutes: number
  pomodorosDone: number
  timerRunning: boolean
  /** Session has started (DB: Active/Break; local: timer has run). Stop is shown only then. */
  started: boolean
  /** Break screen is open: the dock shows the break countdown instead of the focus timer. */
  onBreak: boolean
  breakSeconds: number
  breakMinutes: number
  checked: boolean[]
  currentGoal: string
  isTired: boolean
  tiredNotice: boolean
  checkInCorner: CheckInCorner
  /** My status as the session sees it (SpacetimeDB); null outside a DB session (demo uses local state). */
  selfStatus?: 'focused' | 'drifting' | null
  /** Shared by everyone in this study session. LiveKit room is lockin-<code>. */
  sessionCode: string
  displayName: string
  /** Real session members. Empty when nobody else has joined. */
  members: { name: string; initials: string; status: string; hex?: string }[]
}

/** Dock buttons the overlay cannot handle itself; the main window owns this state. */
export type OverlayAction =
  | { type: 'setTimerRunning'; running: boolean }
  | { type: 'resetPomodoro' }
  | { type: 'setChecked'; checked: boolean[] }
  | { type: 'signalTired' }
  | { type: 'dismissTired' }
  | { type: 'takeBreak' }
  | { type: 'endBreak' }
  | { type: 'leave' }

export type ToOverlay =
  | { type: 'state'; state: OverlayState }
  | { type: 'checkIn'; target: 'me' | 'teammate'; scenario: 'none' | 'people' }
  | { type: 'reveal' }
  | { type: 'reset' }

export type ToMain = { type: 'ready' } | { type: 'action'; action: OverlayAction }

export type BridgeMessage = ToOverlay | ToMain
