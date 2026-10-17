// KentraPix pour ordinateur : fenêtre Electron qui charge le site en ligne.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const SITE = process.env.KENTRAPIX_URL || 'https://kentrapix.kenleyelysee.com';
const HOST = new URL(SITE).host;

// Seuls les liens web et e-mail sortent vers le système : jamais file:, ni un protocole d'application.
function openExternal(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch { /* adresse invalide : ignorée */ }
}
const sameSite = (url) => { try { return new URL(url).host === HOST; } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    backgroundColor: '#f4f7fc',
    title: 'KentraPix',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  Menu.setApplicationMenu(null);
  win.loadURL(SITE);
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  // Liens externes : navigateur par défaut. Le reste de KentraPix reste dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return; // page « hors connexion » locale
    if (!sameSite(url)) { e.preventDefault(); openExternal(url); }
  });
}

app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
