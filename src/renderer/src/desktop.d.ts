import type { ActivityState } from '../../main/activityMonitor'

type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

// Mirrors `wydDesktop` in src/preload/index.ts.
declare global {
  interface Window {
    wydDesktop?: {
      platform: string
      getPreferences(): Promise<{ checkInCorner?: CheckInCorner }>
      setPreferences(update: { checkInCorner?: CheckInCorner }): Promise<{ checkInCorner: CheckInCorner }>
      requestMediaPermissions(): Promise<{ camera: boolean; microphone: boolean }>
      setAlwaysOnTop(enabled: boolean): Promise<void>
      setIgnoreMouseEvents(enabled: boolean): Promise<void>
      moveToCorner(corner: CheckInCorner, size?: { width?: number; height?: number }): Promise<void>
      getDisplays(): Promise<unknown[]>
      setOverlayVisible(visible: boolean): Promise<void>
      bridge: {
        send(message: unknown): void
        onMessage(cb: (message: unknown) => void): void
        removeListeners(): void
      }
      startTracking(context: { subject: string; goals: string[] }): Promise<void>
      onActivityUpdate(cb: (state: ActivityState) => void): void
      onActivityAlert(cb: (state: ActivityState) => void): void
      removeActivityListeners(): void
    }
  }
}

export {}
