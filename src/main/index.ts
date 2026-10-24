import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { ActivityMonitor } from './activityMonitor'
import { SessionManager } from './sessionManager'

let mainWindow: BrowserWindow | null = null
let monitor: ActivityMonitor | null = null
const session = new SessionManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
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

app.whenReady().then(() => {
  createWindow()

  monitor = new ActivityMonitor()

  monitor.onUpdate(state => {
    if (!mainWindow) return
    mainWindow.webContents.send('activity:update', state)
    if (state.alertLevel === 'warning' || state.alertLevel === 'alert') {
      mainWindow.webContents.send('activity:alert', state)
    }
  })

  // Session onboarding: phase changes (speaking/listening/processing/done)
  session.onPhase(phase => {
    mainWindow?.webContents.send('session:phase', phase)
  })

  // When context is ready, give it to the monitor so Claude can judge
  session.onReady(ctx => {
    monitor?.setSessionContext(ctx)
    mainWindow?.webContents.send('session:context-ready', ctx)
  })

  // Renderer triggers: "Start Session" button clicked
  ipcMain.handle('session:start', async () => {
    monitor?.start()
    await session.startOnboarding()
  })

  // Renderer sends the user's spoken response
  ipcMain.handle('session:user-response', async (_event, transcript: string) => {
    await session.handleUserResponse(transcript)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  monitor?.stop()
  if (process.platform !== 'darwin') app.quit()
})
