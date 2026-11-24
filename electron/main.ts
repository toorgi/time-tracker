import { app, BrowserWindow, ipcMain, powerMonitor, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
const APP_ROOT = path.join(__dirname, '..')
process.env.APP_ROOT = APP_ROOT

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(APP_ROOT, 'dist')

const VITE_PUBLIC_PATH = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : RENDERER_DIST
process.env.VITE_PUBLIC = VITE_PUBLIC_PATH

let win: BrowserWindow | null = null
let savedNormalBounds: WindowBounds | null = null
let wasMaximizedBeforeMini = false
let isMiniWindowActive = false

function isExternalUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')
}

function createWindow() {
  isMiniWindowActive = false
  win = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 820,
    minHeight: 620,
    autoHideMenuBar: true,
    icon: path.join(VITE_PUBLIC_PATH, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // פתיחת קישורים חיצוניים (מפתח Gemini AI, וואטסאפ, מייל) בדפדפן/תוכנת המייל של המשתמש ולא בתוך חלון Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const devOrigin = VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : null
    const isInternalDev = devOrigin !== null && url.startsWith(devOrigin)
    if (!isInternalDev && isExternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url).catch(() => {})
    }
  })

  // שליחת הודעה לחלון לאחר טעינת הדף
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.on('closed', () => {
    isMiniWindowActive = false
    savedNormalBounds = null
    win = null
  })
}

// הורדה אוטומטית שקטה ברקע והתקנה אוטומטית בסגירה הבאה (ללא צורך בלחיצת המשתמש)
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

// מעבר עדכונים לחלון ה-React
autoUpdater.on('update-available', (info: { version: string }) => {
  win?.webContents.send('update-status', { type: 'available', version: info.version })
})

autoUpdater.on('update-not-available', () => {
  win?.webContents.send('update-status', { type: 'not-available' })
})

autoUpdater.on('download-progress', (progressObj: { percent: number }) => {
  win?.webContents.send('update-status', {
    type: 'progress',
    percent: Math.round(progressObj.percent),
  })
})

autoUpdater.on('update-downloaded', (info?: { version?: string }) => {
  win?.webContents.send('update-status', { type: 'downloaded', version: info?.version })
})

autoUpdater.on('error', (err: Error) => {
  win?.webContents.send('update-status', { type: 'error', message: err?.message || String(err) })
})

// קבלת קריאות מה-React (IPC)
ipcMain.on('check-for-update', () => {
  // במצב פיתוח (ללא התקנה) אין קובץ עדכון מקומי, נחזיר הודעה מסודרת
  if (!app.isPackaged) {
    win?.webContents.send('update-status', { type: 'not-available' })
    return
  }
  autoUpdater.checkForUpdates().catch((err: Error) => {
    win?.webContents.send('update-status', { type: 'error', message: err.message })
  })
})

ipcMain.on('start-download-update', () => {
  autoUpdater.downloadUpdate().catch((err: Error) => {
    win?.webContents.send('update-status', { type: 'error', message: err.message })
  })
})

ipcMain.on('restart-and-install', () => {
  autoUpdater.quitAndInstall()
})

// מעבר אמיתי למצב מיני צף בפינת המסך (מעל כל שאר החלונות)
ipcMain.on('enter-mini-mode', () => {
  if (!win || win.isDestroyed() || isMiniWindowActive) return
  try {
    wasMaximizedBeforeMini = win.isMaximized()
    if (wasMaximizedBeforeMini) {
      win.unmaximize()
    }
    savedNormalBounds = win.getBounds()
    const display = screen.getDisplayMatching(savedNormalBounds)
    const { x, y, height } = display.workArea
    const miniWidth = 340
    const miniHeight = 240

    isMiniWindowActive = true
    win.setMinimumSize(300, 210)
    win.setResizable(true)
    win.setBounds(
      {
        x: Math.round(x + 18),
        y: Math.round(y + height - miniHeight - 18),
        width: miniWidth,
        height: miniHeight,
      },
      true
    )
    win.setMaximizable(false)
    win.setResizable(false)
    win.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    win.setTitle('TimeTracker • מצב מיני')
  } catch (err) {
    console.error('Failed to enter mini mode:', err)
  }
})

// חזרה נקייה ממצב מיני לגודל ולמיקום המקוריים של החלון
ipcMain.on('exit-mini-mode', () => {
  if (!win || win.isDestroyed() || !isMiniWindowActive) return
  try {
    isMiniWindowActive = false
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(false)
    }
    win.setAlwaysOnTop(false)
    win.setResizable(true)
    win.setMaximizable(true)
    win.setMinimumSize(820, 620)
    win.setTitle('TimeTracker')

    if (savedNormalBounds) {
      win.setBounds(savedNormalBounds, true)
    } else {
      win.setSize(1200, 850, true)
      win.center()
    }

    if (wasMaximizedBeforeMini) {
      win.maximize()
    }
  } catch (err) {
    console.error('Failed to exit mini mode:', err)
  }
})

// בדיקה תקופתית שקטה מרחוק כל 6 שעות (למשתמשים שמשאירים את התוכנה פתוחה)
const updateCheckInterval = setInterval(() => {
  if (app.isPackaged && win && !win.isDestroyed()) {
    autoUpdater.checkForUpdates().catch(() => {
      // התעלמות שקטה משגיאת רשת בבדיקה תקופתית ברקע
    })
  }
}, 6 * 60 * 60 * 1000)

// מנגנון ניטור חוסר פעילות במחשב (Smart Idle Detection)
const idleCheckInterval = setInterval(() => {
  if (win && !win.isDestroyed()) {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    win.webContents.send('system-idle-time', idleSeconds)
  }
}, 3000)

app.on('before-quit', () => {
  clearInterval(updateCheckInterval)
  clearInterval(idleCheckInterval)
})

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

app.whenReady().then(() => {
  createWindow()
  // בדיקה והורדה אוטומטית שקטה 6 שניות לאחר פתיחת התוכנה (בגרסה המותקנת בלבד)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // התעלמות שקטה משגיאת רשת בהפעלה אוטומטית
      })
    }, 6000)
  }
})