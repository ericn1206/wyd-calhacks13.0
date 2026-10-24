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
  requestMediaAccess: () => ipcRenderer.invoke('media:request-access') as Promise<{ camera: boolean; microphone: boolean }>,
  getSignalInfo: () => ipcRenderer.invoke('signal:info') as Promise<{ port: number; urls: string[] }>,
  setCallMode: (on: boolean) => ipcRenderer.invoke('window:call-mode', on),
  watchCircle: (code: string, name: string, onHost: (host: { url: string; name: string } | null) => void) => {
    const listener = (_event: unknown, host: { url: string; name: string } | null) => onHost(host)
    ipcRenderer.on('lan:host', listener)
    void ipcRenderer.invoke('lan:start', code, name)
    return () => {
      ipcRenderer.removeListener('lan:host', listener)
      void ipcRenderer.invoke('lan:stop')
    }
  }
})
