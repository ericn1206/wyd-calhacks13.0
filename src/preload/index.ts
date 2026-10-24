import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityState } from '../main/activityMonitor'
import type { SessionContext } from '../main/claudeJudge'
import type { OnboardingPhase } from '../main/sessionManager'

contextBridge.exposeInMainWorld('activityAPI', {
  onUpdate: (cb: (state: ActivityState) => void) => {
    ipcRenderer.on('activity:update', (_e, state) => cb(state))
  },
  onAlert: (cb: (state: ActivityState) => void) => {
    ipcRenderer.on('activity:alert', (_e, state) => cb(state))
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('activity:update')
    ipcRenderer.removeAllListeners('activity:alert')
  }
})

contextBridge.exposeInMainWorld('sessionAPI', {
  start: () => ipcRenderer.invoke('session:start'),
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
