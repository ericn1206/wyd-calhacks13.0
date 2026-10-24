import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session as electronSession, shell, systemPreferences } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ActivityMonitor } from './activityMonitor'
import type { SessionContext } from './claudeJudge'
import { loadEnv } from './env'
import { createCallToken } from './livekitToken'

loadEnv()

let mainWindow: BrowserWindow | null = null
let monitor: ActivityMonitor | null = null

type CheckInCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
const preferencesPath = () => join(app.getPath('userData'), 'preferences.json')

async function readPreferences(): Promise<{ checkInCorner: CheckInCorner }> {
  try {
    return JSON.parse(await fs.readFile(preferencesPath(), 'utf8'))
  } catch {
    return { checkInCorner: 'top-right' }
  }
}

async function writePreferences(update: object) {
  const next = { ...(await readPreferences()), ...update }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(preferencesPath(), JSON.stringify(next, null, 2))
  return next
}

function configurePermissions(): void {
  const allowed = new Set(['media', 'display-capture', 'fullscreen'])
  const sesh = electronSession.defaultSession
  sesh.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  sesh.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  sesh.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    callback({ video: sources[0] })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    title: 'WYD!!',
    backgroundColor: '#f7f8f5',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
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

function registerDesktopApi(): void {
  ipcMain.handle('wyd:preferences:get', readPreferences)
  ipcMain.handle('wyd:preferences:set', (_e, update) => writePreferences(update))
  ipcMain.handle('wyd:media:request', async () => {
    if (process.platform !== 'darwin') return { camera: true, microphone: true }
    const camera = await systemPreferences.askForMediaAccess('camera')
    const microphone = await systemPreferences.askForMediaAccess('microphone')
    return { camera, microphone }
  })
  ipcMain.handle('wyd:window:always-on-top', (event, enabled: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setAlwaysOnTop(Boolean(enabled), 'floating')
    window?.setVisibleOnAllWorkspaces(Boolean(enabled), { visibleOnFullScreen: true })
  })
  ipcMain.handle('wyd:window:ignore-mouse', (event, enabled: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(Boolean(enabled), { forward: true })
  })
  ipcMain.handle('wyd:window:move-to-corner', (event, corner: CheckInCorner, size: { width?: number; height?: number } = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const width = Math.max(320, Math.min(Number(size.width) || window.getBounds().width, display.workArea.width))
    const height = Math.max(80, Math.min(Number(size.height) || window.getBounds().height, display.workArea.height))
    const padding = 16
    const x = corner.endsWith('right') ? display.workArea.x + display.workArea.width - width - padding : display.workArea.x + padding
    const y = corner.startsWith('bottom') ? display.workArea.y + display.workArea.height - height - padding : display.workArea.y + padding
    window.setBounds({ x, y, width, height }, true)
  })
  ipcMain.handle('wyd:displays:get', () =>
    screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor }))
  )

  // LiveKit call plumbing for src/renderer/src/useCircleCall.ts (not wired into the UI yet).
  ipcMain.handle('call:token', (_e, code: string, identity: string, name: string) => createCallToken(code, identity, name))
  ipcMain.handle('window:call-mode', (_e, on: boolean) => {
    if (!mainWindow) return
    mainWindow.setAlwaysOnTop(Boolean(on))
    if (on) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Goals screen submit → give the judge its context and start polling.
  ipcMain.handle('wyd:tracking:start', (_e, ctx: { subject: string; goals: string[] }) => {
    const context: SessionContext = { subject: ctx.subject, goals: ctx.goals, sites: '', notes: '' }
    monitor?.setSessionContext(context)
    monitor?.start()
  })
}

app.whenReady().then(() => {
  configurePermissions()
  registerDesktopApi()
  createWindow()

  monitor = new ActivityMonitor()
  monitor.onUpdate(state => {
    sendToRenderer('activity:update', state)
    if (state.alertLevel === 'warning' || state.alertLevel === 'alert') {
      sendToRenderer('activity:alert', state)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  monitor?.stop()
  if (process.platform !== 'darwin') app.quit()
})
