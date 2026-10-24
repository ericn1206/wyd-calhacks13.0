import { app, BrowserWindow, ipcMain, session as electronSession, systemPreferences } from 'electron'
import { join } from 'path'
import { ActivityMonitor } from './activityMonitor'
import { createAgentSession } from './cartesiaAgent'
import { loadEnv } from './env'
import { SessionManager } from './sessionManager'
import { startLanDiscovery } from './lanDiscovery'
import { listSignalUrls, SIGNAL_PORT, startSignalServer, stopSignalServer } from './signalServer'

loadEnv()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
let monitor: ActivityMonitor | null = null
let stopDiscovery: (() => void) | null = null
const session = new SessionManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendToRenderer(channel: string, payload?: unknown): void {
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    contents.send(channel, payload)
  } catch (err) {
    console.error('[ipc] dropped', channel, err)
  }
}

function allowMicrophone(): void {
  const sesh = electronSession.defaultSession
  // The request handler below only grants the microphone and camera.
  // Other checks stay allowed so the window does not go blank.
  sesh.setPermissionCheckHandler(() => true)
  sesh.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
}

app.whenReady().then(async () => {
  allowMicrophone()
  try {
    await startSignalServer()
  } catch (err) {
    console.error('[signal] failed to start', err)
  }
  createWindow()
  mainWindow?.webContents.setBackgroundThrottling(false)
  mainWindow?.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] exited', details.reason, details.exitCode)
    if (details.reason === 'clean-exit' || !mainWindow) return
    console.error('[renderer] reloading after a crash so the window does not stay black')
    mainWindow.reload()
  })

  monitor = new ActivityMonitor()

  monitor.onUpdate(state => {
    sendToRenderer('activity:update', state)
    if (state.alertLevel === 'warning' || state.alertLevel === 'alert') {
      sendToRenderer('activity:alert', state)
    }
  })

  // Session onboarding: phase changes (speaking/listening/processing/done)
  session.onPhase(phase => {
    sendToRenderer('session:phase', phase)
  })

  // When context is ready, give it to the monitor so Claude can judge
  session.onReady(ctx => {
    monitor?.setSessionContext(ctx)
    sendToRenderer('session:context-ready', ctx)
  })

  // Renderer triggers: "Start Session" button clicked
  ipcMain.handle('session:start', async () => {
    monitor?.start()
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) {
        throw new Error('Microphone access is off. Turn it on for Electron in System Settings, then start the session again.')
      }
    }
    const creds = await createAgentSession()
    session.beginListening()
    return creds
  })

  // Renderer sends the user's spoken response
  ipcMain.handle('session:user-response', async (_event, transcript: string) => {
    await session.handleUserResponse(transcript)
  })

  ipcMain.handle('media:request-access', async () => {
    if (process.platform !== 'darwin') return { camera: true, microphone: true }
    const microphone = await systemPreferences.askForMediaAccess('microphone')
    const camera = await systemPreferences.askForMediaAccess('camera')
    return { camera, microphone }
  })

  ipcMain.handle('signal:info', () => ({
    port: SIGNAL_PORT,
    urls: listSignalUrls()
  }))

  ipcMain.handle('lan:start', (event, code: string, name: string) => {
    stopDiscovery?.()
    stopDiscovery = startLanDiscovery({
      code: String(code ?? ''),
      name: String(name ?? ''),
      onHost: (host) => {
        if (event.sender.isDestroyed()) return
        event.sender.send('lan:host', host)
      }
    })
  })

  ipcMain.handle('lan:stop', () => {
    stopDiscovery?.()
    stopDiscovery = null
  })

  ipcMain.handle('window:call-mode', (_event, on: boolean) => {
    if (!mainWindow) return
    const active = Boolean(on)
    mainWindow.setAlwaysOnTop(active)
    if (active) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopDiscovery?.()
  stopDiscovery = null
  stopSignalServer()
})

app.on('window-all-closed', () => {
  monitor?.stop()
  if (process.platform !== 'darwin') app.quit()
})
