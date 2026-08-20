const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    autoHideMenuBar: true, // מסתיר את שורת התפריטים העליונה
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // התיקון הקריטי למסך הלבן ב-EXE - מציאת הנתיב המדויק לטעינת התוכנה
  if (process.env.VITE_DEV_SERVER_URL) {
    // מצב פיתוח (npm run dev)
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // מצב ייצור (התוכנה המקומפלת למשתמש)
    const indexPathRoot = path.join(__dirname, 'dist', 'index.html');
    const indexPathDist = path.join(__dirname, '../dist', 'index.html');
    
    // בודק היכן בדיוק נוצר הקובץ וטוען אותו
    if (fs.existsSync(indexPathRoot)) {
      mainWindow.loadFile(indexPathRoot);
    } else {
      mainWindow.loadFile(indexPathDist);
    }
  }

  // מנגנון זיהוי חוסר פעילות במחשב (מנטר כל שנייה ושולח ל-App.tsx)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      mainWindow.webContents.send('system-idle-time', idleSeconds);
    }
  }, 1000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// האזנה מ-App.tsx למעבר למצב מיני (חלון צף)
ipcMain.on('toggle-mini-mode', (event, isMini) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  if (isMini) {
    mainWindow.setSize(350, 250); // מקטין את החלון
    mainWindow.setAlwaysOnTop(true); // תמיד מעל חלונות אחרים
  } else {
    mainWindow.setSize(1000, 800); // מחזיר לגודל מקורי
    mainWindow.setAlwaysOnTop(false);
    mainWindow.center(); // ממקם באמצע המסך
  }
});