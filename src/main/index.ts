import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session as electronSession, shell, systemPreferences } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ActivityMonitor } from './activityMonitor'
import { createAgentSession } from './cartesiaAgent'
import { requestClip, startFacetimeTrigger, stopFacetimeTrigger, type ClipInfo, type DetectorDebug } from './facetimeTrigger'
import { clearClipDir, newClipPath, uploadClip } from './clipUpload'
import type { SessionContext } from './claudeJudge'
import { loadEnv } from './env'
import { createCallToken } from './livekitToken'
import { SessionManager } from './sessionManager'
import { StdbClient } from './db/stdb'

loadEnv()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let monitor: ActivityMonitor | null = null
const session = new SessionManager()

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

  mainWindow.on('closed', () => { overlayWindow?.close(); mainWindow = null })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // http:// too: the session highlight page is served by the clip compiler on a LAN address.
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Transparent, click-through window covering the main window's display; renders the dock and check-ins. */
function createOverlayWindow(): BrowserWindow {
  const display = screen.getDisplayMatching(mainWindow?.getBounds() ?? screen.getPrimaryDisplay().bounds)
  const { x, y, width, height } = display.workArea
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    // macOS: a non-activating panel, so clicking the dock/check-in doesn't activate the app and pull the
    // main window in front.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // skipTransformProcessType: otherwise Electron turns the app into a UI-element process on macOS,
  // which removes its icon from the Dock.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?overlay=1`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: '1' } })
  }
  win.on('closed', () => { overlayWindow = null })
  return win
}

function sendTo(window: BrowserWindow | null, channel: string, payload?: unknown): void {
  const contents = window?.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    contents.send(channel, payload)
  } catch (err) {
    console.error('[ipc] dropped', channel, err)
  }
}

function sendToRenderer(channel: string, payload?: unknown): void {
  sendTo(mainWindow, channel, payload)
}

// Detector debug log for the Demo menu's log window and the dock debug strip (last 300 intervals).
const DETECTOR_LOG_MAX = 300
const detectorLog: DetectorDebug[] = []
function recordDetectorDebug(entry: DetectorDebug): void {
  detectorLog.push(entry)
  if (detectorLog.length > DETECTOR_LOG_MAX) detectorLog.splice(0, detectorLog.length - DETECTOR_LOG_MAX)
  sendToRenderer('wyd:detector-debug', entry)
}

// True while the main window is on the focus/break screen (it asks for the overlay); the detector's
// `face time` must not pop a check-in on the summary or entry screens.
let overlayWanted = false

function publishFacetime(): void {
  if (!overlayWanted) return
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive()
  sendTo(overlayWindow, 'facetime:start')
  recordClip()
}

// Clip of the off-task moment (10 s before, 20 s after) for the session's compilation. Only in a DB session;
// the detector skips a request while it is still writing the previous clip.
function recordClip(): void {
  const snap = stdb.snapshot()
  if (!snap.connected || !snap.tables.sessions.some(s => (s.state as { tag: string }).tag !== 'Ended')) return
  if (!requestClip(newClipPath())) console.warn('[clip] tracking is off; no clip')
}

function handleClip(info: ClipInfo): void {
  if (!info.clip) console.warn('[clip] detector could not record:', info.error)
  else void uploadClip(stdb, info)
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
    window?.setVisibleOnAllWorkspaces(Boolean(enabled), { visibleOnFullScreen: true, skipTransformProcessType: true })
  })
  // While this laptop shares its screen, hide the calling window (overlay with everyone's camera tiles)
  // from screen capture (macOS: excluded from the capture stream, still visible to the user).
  ipcMain.handle('wyd:window:capture-hidden', (event, hidden: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setContentProtection(Boolean(hidden))
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

  ipcMain.handle('wyd:overlay:set-visible', (_e, visible: boolean) => {
    overlayWanted = Boolean(visible)
    if (visible) {
      overlayWindow = overlayWindow ?? createOverlayWindow()
      overlayWindow.showInactive()
    } else {
      overlayWindow?.hide()
    }
  })
  // Relay between the main window and the overlay window: each side's messages go to the other.
  ipcMain.on('wyd:bridge:send', (event, message) => {
    const target = overlayWindow && event.sender === overlayWindow.webContents ? mainWindow : overlayWindow
    if (target && !target.webContents.isDestroyed()) target.webContents.send('wyd:bridge:message', message)
  })

  // LiveKit call plumbing for the overlay check-in (src/renderer/src/overlay/LiveCheckIn.tsx).
  ipcMain.handle('call:token', (_e, code: string, identity: string, name: string) => createCallToken(code, identity, name))
  ipcMain.handle('window:call-mode', (_e, on: boolean) => {
    // The check-in cameras live on the overlay, which is already above every app.
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) return
    if (!mainWindow) return
    mainWindow.setAlwaysOnTop(Boolean(on))
    if (on) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // SpacetimeDB: main owns the single connection; both windows get plain-JSON snapshots.
  ipcMain.handle('wyd:db:snapshot', () => stdb.snapshot())
  ipcMain.handle('wyd:db:call', async (_e, name: string, args?: Record<string, unknown>) => {
    try { await stdb.call(name, args); return { ok: true } } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) } }
  })

  // Goals or the voice interview → give the judge its context and start polling.
  ipcMain.handle('wyd:detector-log:get', () => detectorLog)
  // Leaving the session (summary / entry screen): stop the webcam + screen checks and activity polling.
  ipcMain.handle('wyd:tracking:stop', () => {
    stopFacetimeTrigger()
    monitor?.stop()
  })
  ipcMain.handle('wyd:tracking:start', (_e, ctx: { subject: string; goals: string[]; sites?: string; notes?: string }) => {
    const context: SessionContext = {
      subject: ctx.subject,
      goals: ctx.goals ?? [],
      sites: ctx.sites ?? '',
      notes: ctx.notes ?? '',
    }
    monitor?.setSessionContext(context)
    monitor?.start()
    // Gemini judges the OCR text against what they said they are doing. Sites/notes are optional extra context.
    const goalParts = [context.subject, ...context.goals, context.notes].map((part) => part.trim()).filter(Boolean)
    const goal = goalParts.filter((part, index) => goalParts.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index).join('. ') || 'study'
    const mentioned = [context.sites, context.notes].map((part) => part.trim()).filter(Boolean).join('. ')
    startFacetimeTrigger(goal, publishFacetime, (offTask) => sendToRenderer('wyd:detector-status', offTask), recordDetectorDebug, handleClip, mentioned)
  })

  ipcMain.handle('session:start', async () => {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) throw new Error('Microphone access is off. Turn it on for Electron in System Settings, then try the voice intro again.')
    }
    const creds = await createAgentSession()
    session.beginListening()
    return creds
  })
  ipcMain.handle('session:user-response', async (_e, transcript: string) => {
    await session.handleUserResponse(transcript)
  })
}

const stdb = new StdbClient()

app.whenReady().then(() => {
  // Chromium's built-in DNS client fails on LiveKit's TURN/media hosts (ERR_NAME_NOT_RESOLVED) when a
  // VPN tunnel is up, while macOS resolves them fine. Use the system resolver instead.
  app.configureHostResolver({ enableBuiltInResolver: false })
  configurePermissions()
  clearClipDir()
  registerDesktopApi()
  createWindow()

  stdb.onChange(snapshot => sendToRenderer('wyd:db:state', snapshot))
  stdb.connect().catch(err => console.error('[stdb] connect failed', err))

  monitor = new ActivityMonitor()
  session.onPhase(phase => sendToRenderer('session:phase', phase))
  session.onReady(ctx => sendToRenderer('session:context-ready', ctx))
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
  stopFacetimeTrigger()
  stdb.disconnect()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopFacetimeTrigger())
