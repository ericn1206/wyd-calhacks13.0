import type { ActivityState } from '../../main/activityMonitor'
import type { DetectorDebug } from '../../main/facetimeTrigger'

type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

// Mirrors `wydDesktop` in src/preload/index.ts; keep the two in sync.
declare global {
  interface Window {
    wydDesktop?: {
      platform: string
      getPreferences(): Promise<{ checkInCorner?: CheckInCorner; dockDebug?: boolean }>
      setPreferences(update: { checkInCorner?: CheckInCorner; dockDebug?: boolean }): Promise<{ checkInCorner: CheckInCorner; dockDebug?: boolean }>
      requestMediaPermissions(): Promise<{ camera: boolean; microphone: boolean }>
      setAlwaysOnTop(enabled: boolean): Promise<void>
      setIgnoreMouseEvents(enabled: boolean): Promise<void>
      setCaptureHidden(hidden: boolean): Promise<void>
      moveToCorner(corner: CheckInCorner, size?: { width?: number; height?: number }): Promise<void>
      getDisplays(): Promise<unknown[]>
      setOverlayVisible(visible: boolean): Promise<void>
      bridge: {
        send(message: unknown): void
        onMessage(cb: (message: unknown) => void): void
        removeListeners(): void
      }
      db: {
        snapshot(): Promise<unknown>
        call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
        onState(cb: (snapshot: unknown) => void): () => void
      }
      startTracking(context: { subject: string; goals: string[]; sites?: string; notes?: string }): Promise<void>
      stopTracking(): Promise<void>
      onDetectorStatus(cb: (offTask: boolean) => void): () => void
      getDetectorLog(): Promise<DetectorDebug[]>
      onDetectorDebug(cb: (entry: DetectorDebug) => void): () => void
      onActivityUpdate(cb: (state: ActivityState) => void): void
      onActivityAlert(cb: (state: ActivityState) => void): void
      removeActivityListeners(): void
    }
  }
}

export {}
