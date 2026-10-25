export {}

import type { ActivityState } from './../../main/activityMonitor'
import type { DbSnapshot } from './db/useDb'

type VoicePhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'
type VoiceContext = { subject: string; goals: string[]; sites: string; notes: string }
type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

declare global {
  interface Window {
    wydDesktop?: {
      platform: string
      getPreferences(): Promise<{ checkInCorner?: CheckInCorner }>
      setPreferences(update: { checkInCorner?: CheckInCorner }): Promise<void>
      requestMediaPermissions(): Promise<{ camera: boolean; microphone: boolean }>
      setAlwaysOnTop(enabled: boolean): Promise<void>
      setIgnoreMouseEvents(enabled: boolean): Promise<void>
      moveToCorner(corner: CheckInCorner, size?: { width?: number; height?: number }): Promise<void>
      getDisplays(): Promise<unknown>
      setOverlayVisible(visible: boolean): Promise<void>
      bridge: {
        send(message: unknown): void
        onMessage(cb: (message: unknown) => void): void
        removeListeners(): void
      }
      db: {
        snapshot(): Promise<DbSnapshot>
        call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
        onState(cb: (snapshot: DbSnapshot) => void): () => void
      }
      startTracking(context: { subject: string; goals: string[]; sites?: string; notes?: string }): Promise<void>
      onActivityUpdate(cb: (state: ActivityState) => void): void
      onActivityAlert(cb: (state: ActivityState) => void): void
      removeActivityListeners(): void
    }
    sessionAPI: {
      start(): Promise<{ token: string; agentId: string }>
      submitResponse(transcript: string): Promise<void>
      onPhase(cb: (phase: VoicePhase) => void): void
      onContextReady(cb: (ctx: VoiceContext) => void): void
      removeAllListeners(): void
    }
    circleAPI: {
      requestMediaAccess(): Promise<{ camera: boolean; microphone: boolean }>
      getCallToken(code: string, identity: string, name: string): Promise<{ url: string; token: string; room: string }>
      setCallMode(on: boolean): Promise<void>
      onFacetime(cb: () => void): () => void
    }
  }
}
