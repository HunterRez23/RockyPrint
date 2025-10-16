// app/main/main.js
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

// --- Cargar .env (dev: raíz del proyecto, prod: resources/.env) ---
const devEnvPath  = path.resolve(__dirname, '../../.env');
const prodEnvPath = path.join(process.resourcesPath || '', '.env');
const envPath = isDev && fs.existsSync(devEnvPath) ? devEnvPath
               : fs.existsSync(prodEnvPath)       ? prodEnvPath
               : devEnvPath; // fallback

dotenv.config({ path: envPath });

// ⚠️ Importa handlers DESPUÉS de cargar dotenv, para que vean PG_URL/PG_SSL
await import('./ipc-handlers.js');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.setAppUserModelId('com.rockyprint.app');

// Evitar doble instancia
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWin(startHtml = 'login.html') {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    fullscreen: false,
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
