import type { ActivityState } from '../../main/activityMonitor'
import type { SessionContext } from '../../main/claudeJudge'
import type { OnboardingPhase } from '../../main/sessionManager'

declare global {
  interface Window {
    activityAPI: {
      onUpdate: (cb: (state: ActivityState) => void) => void
      onAlert: (cb: (state: ActivityState) => void) => void
      removeAllListeners: () => void
    }
    sessionAPI: {
      start: () => Promise<void>
      submitResponse: (transcript: string) => Promise<void>
      onPhase: (cb: (phase: OnboardingPhase) => void) => void
      onContextReady: (cb: (ctx: SessionContext) => void) => void
      removeAllListeners: () => void
    }
  }
}

export {}
