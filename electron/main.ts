import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ביטול הורדה אוטומטית ברקע ללא אישור המשתמש
autoUpdater.autoDownload = false

// מעבר עדכונים לחלון ה-React
autoUpdater.on('update-available', (info) => {
  win?.webContents.send('update-status', { type: 'available', version: info.version })
})

autoUpdater.on('update-not-available', () => {
  win?.webContents.send('update-status', { type: 'not-available' })
})

autoUpdater.on('download-progress', (progressObj) => {
  win?.webContents.send('update-status', { 
    type: 'progress', 
    percent: Math.round(progressObj.percent) 
  })
})

autoUpdater.on('update-downloaded', () => {
  win?.webContents.send('update-status', { type: 'downloaded' })
})

autoUpdater.on('error', (err) => {
  win?.webContents.send('update-status', { type: 'error', message: err.message })
})

// קבלת קריאות מה-React (IPC)
ipcMain.on('check-for-update', () => {
  autoUpdater.checkForUpdates().catch((err) => {
    win?.webContents.send('update-status', { type: 'error', message: err.message })
  })
})

ipcMain.on('start-download-update', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.on('restart-and-install', () => {
  autoUpdater.quitAndInstall()
})

// מנגנון ניטור חוסר פעילות במחשב (Smart Idle Detection)
setInterval(() => {
  if (win && !win.isDestroyed()) {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    win.webContents.send('system-idle-time', idleSeconds)
  }
}, 3000)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)