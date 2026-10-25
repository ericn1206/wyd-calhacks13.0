export type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

/** Main-window state the overlay window needs to draw the dock. Sent on every change. */
export type OverlayState = {
  host: boolean
  focusSeconds: number
  pomodoroMinutes: number
  pomodorosDone: number
  timerRunning: boolean
  checked: boolean[]
  currentGoal: string
  isTired: boolean
  tiredNotice: boolean
  checkInCorner: CheckInCorner
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
  | { type: 'leave' }

export type ToOverlay =
  | { type: 'state'; state: OverlayState }
  | { type: 'checkIn'; target: 'me' | 'teammate'; scenario: 'none' | 'people' }
  | { type: 'reveal' }
  | { type: 'reset' }

export type ToMain = { type: 'ready' } | { type: 'action'; action: OverlayAction }

export type BridgeMessage = ToOverlay | ToMain
