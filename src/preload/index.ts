import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityState } from '../main/activityMonitor'
import type { DetectorDebug } from '../main/facetimeTrigger'
import type { SessionContext } from '../main/claudeJudge'
import type { OnboardingPhase } from '../main/sessionManager'

type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

contextBridge.exposeInMainWorld('wydDesktop', {
  platform: process.platform,
  getPreferences: () => ipcRenderer.invoke('wyd:preferences:get'),
  setPreferences: (update: { checkInCorner?: CheckInCorner; dockDebug?: boolean }) => ipcRenderer.invoke('wyd:preferences:set', update),
  requestMediaPermissions: () => ipcRenderer.invoke('wyd:media:request'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('wyd:window:always-on-top', enabled),
  setIgnoreMouseEvents: (enabled: boolean) => ipcRenderer.invoke('wyd:window:ignore-mouse', enabled),
  setCaptureHidden: (hidden: boolean) => ipcRenderer.invoke('wyd:window:capture-hidden', hidden),
  moveToCorner: (corner: CheckInCorner, size?: { width?: number; height?: number }) =>
    ipcRenderer.invoke('wyd:window:move-to-corner', corner, size),
  getDisplays: () => ipcRenderer.invoke('wyd:displays:get'),
  // Full-screen overlay window (dock + check-in windows). `send` goes to the other window.
  setOverlayVisible: (visible: boolean) => ipcRenderer.invoke('wyd:overlay:set-visible', visible),
  bridge: {
    send: (message: unknown) => ipcRenderer.send('wyd:bridge:send', message),
    onMessage: (cb: (message: unknown) => void) => {
      ipcRenderer.on('wyd:bridge:message', (_e, message) => cb(message))
    },
    removeListeners: () => ipcRenderer.removeAllListeners('wyd:bridge:message')
  },
  // SpacetimeDB (connection lives in src/main/db/stdb.ts). `call` takes a generated reducer accessor name.
  db: {
    snapshot: () => ipcRenderer.invoke('wyd:db:snapshot'),
    call: (name: string, args?: Record<string, unknown>) => ipcRenderer.invoke('wyd:db:call', name, args) as Promise<{ ok: boolean; error?: string }>,
    onState: (cb: (snapshot: unknown) => void) => {
      const handler = (_e: unknown, snapshot: unknown) => cb(snapshot)
      ipcRenderer.on('wyd:db:state', handler)
      return () => { ipcRenderer.removeListener('wyd:db:state', handler) }
    }
  },
  // Activity tracking (src/main/activityMonitor.ts); UI does not consume these yet.
  startTracking: (context: { subject: string; goals: string[]; sites?: string; notes?: string }) => ipcRenderer.invoke('wyd:tracking:start', context),
  stopTracking: () => ipcRenderer.invoke('wyd:tracking:stop'),
  // Detector debug: one entry per interval (screen OCR vote, webcam, verdict); log kept in main.
  getDetectorLog: () => ipcRenderer.invoke('wyd:detector-log:get') as Promise<DetectorDebug[]>,
  onDetectorDebug: (cb: (entry: DetectorDebug) => void) => {
    const handler = (_e: unknown, entry: DetectorDebug) => cb(entry)
    ipcRenderer.on('wyd:detector-debug', handler)
    return () => { ipcRenderer.removeListener('wyd:detector-debug', handler) }
  },
  // Webcam + screen detector verdict each interval (src/main/facetimeTrigger.ts); true = off task.
  onDetectorStatus: (cb: (offTask: boolean) => void) => {
    const handler = (_e: unknown, offTask: boolean) => cb(offTask)
    ipcRenderer.on('wyd:detector-status', handler)
    return () => { ipcRenderer.removeListener('wyd:detector-status', handler) }
  },
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

contextBridge.exposeInMainWorld('sessionAPI', {
  start: () => ipcRenderer.invoke('session:start') as Promise<{ token: string; agentId: string }>,
  submitResponse: (transcript: string) => ipcRenderer.invoke('session:user-response', transcript),
  onPhase: (cb: (phase: OnboardingPhase) => void) => {
    ipcRenderer.on('session:phase', (_e, phase) => cb(phase))
  },
  onContextReady: (cb: (ctx: SessionContext) => void) => {
    ipcRenderer.on('session:context-ready', (_e, ctx) => cb(ctx))
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('session:phase')
    ipcRenderer.removeAllListeners('session:context-ready')
  }
})

contextBridge.exposeInMainWorld('circleAPI', {
  requestMediaAccess: () => ipcRenderer.invoke('wyd:media:request') as Promise<{ camera: boolean; microphone: boolean }>,
  getCallToken: (code: string, identity: string, name: string, kind?: string) =>
    ipcRenderer.invoke('call:token', code, identity, name, kind) as Promise<{ url: string; token: string; room: string }>,
  setCallMode: (on: boolean) => ipcRenderer.invoke('window:call-mode', on),
  onFacetime: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('facetime:start', handler)
    return () => { ipcRenderer.removeListener('facetime:start', handler) }
  }
})
