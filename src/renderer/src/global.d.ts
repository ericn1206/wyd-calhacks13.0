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
      start: () => Promise<{ token: string; agentId: string }>
      submitResponse: (transcript: string) => Promise<void>
      onPhase: (cb: (phase: OnboardingPhase) => void) => void
      onContextReady: (cb: (ctx: SessionContext) => void) => void
      removeAllListeners: () => void
    }
    circleAPI?: {
      requestMediaAccess: () => Promise<{ camera: boolean; microphone: boolean }>
      getSignalInfo: () => Promise<{ port: number; urls: string[] }>
      setCallMode: (on: boolean) => Promise<void>
      watchCircle: (code: string, name: string, onHost: (host: { url: string; name: string } | null) => void) => () => void
    }
  }
}

export {}
