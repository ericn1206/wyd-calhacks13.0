import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityState } from '../main/activityMonitor'

type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

contextBridge.exposeInMainWorld('wydDesktop', {
  platform: process.platform,
  getPreferences: () => ipcRenderer.invoke('wyd:preferences:get'),
  setPreferences: (update: { checkInCorner?: CheckInCorner }) => ipcRenderer.invoke('wyd:preferences:set', update),
  requestMediaPermissions: () => ipcRenderer.invoke('wyd:media:request'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('wyd:window:always-on-top', enabled),
  setIgnoreMouseEvents: (enabled: boolean) => ipcRenderer.invoke('wyd:window:ignore-mouse', enabled),
  moveToCorner: (corner: CheckInCorner, size?: { width?: number; height?: number }) =>
    ipcRenderer.invoke('wyd:window:move-to-corner', corner, size),
  getDisplays: () => ipcRenderer.invoke('wyd:displays:get'),
  // Activity tracking (src/main/activityMonitor.ts); UI does not consume these yet.
  startTracking: (context: { subject: string; goals: string[] }) => ipcRenderer.invoke('wyd:tracking:start', context),
  onActivityUpdate: (cb: (state: ActivityState) => void) => {
    ipcRenderer.on('activity:update', (_e, state) => cb(state))
  },
  onActivityAlert: (cb: (state: ActivityState) => void) => {
    ipcRenderer.on('activity:alert', (_e, state) => cb(state))
  },
  removeActivityListeners: () => {
    ipcRenderer.removeAllListeners('activity:update')
    ipcRenderer.removeAllListeners('activity:alert')
  }
})

// For useCircleCall.ts (LiveKit); not wired into the UI yet.
contextBridge.exposeInMainWorld('circleAPI', {
  requestMediaAccess: () => ipcRenderer.invoke('wyd:media:request') as Promise<{ camera: boolean; microphone: boolean }>,
  getCallToken: (code: string, identity: string, name: string) =>
    ipcRenderer.invoke('call:token', code, identity, name) as Promise<{ url: string; token: string; room: string }>,
  setCallMode: (on: boolean) => ipcRenderer.invoke('window:call-mode', on)
})
