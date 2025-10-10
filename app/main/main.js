// app/main/main.js
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

// IMPORTA los handlers UNA sola vez (auth, orders, navegar, etc.)
import './ipc-handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.setAppUserModelId('com.rockyprint.app');

// Evita dos instancias
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Crea la ventana principal
function createWin(startHtml = 'login.html') {
  const win = new BrowserWindow({
    fullscreen: false,          // Pantalla completa
    autoHideMenuBar: false,
    show: false,
    width: 1300,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,          // necesario para usar Node en preload con contextBridge
      preload: path.join(__dirname, '../preload/preload.cjs'),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.loadFile(path.join(__dirname, '../renderer', startHtml));
  return win;
}

let mainWindow = null;

app.whenReady().then(() => {
  const startHtml = process.env.START_HTML || 'login.html';
  mainWindow = createWin(startHtml);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWin(startHtml);
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
