const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  safeStorage,
  nativeImage,
} = require('electron');
const { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
let window,
  tray,
  quitting = false,
  connection = null,
  timer,
  inFlight = false,
  generation = 0;
const seen = new Set();
const dev = process.env.PARTYUP_DEV === 'true';
const iconPath = path.join(__dirname, '../dist/assets/logo.png');
const credentialFile = () => path.join(app.getPath('userData'), 'session.enc');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.partyup.app');
  app.on('second-instance', () => show());
  app.whenReady().then(() => {
    window = new BrowserWindow({
      width: 1400,
      height: 970,
      minWidth: 760,
      minHeight: 620,
      title: 'PartyUp',
      backgroundColor: '#101316',
      icon: iconPath,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) event.preventDefault();
    });
    window.webContents.session.on('will-download', (_event, item) => {
      if (!item.getFilename().endsWith('.ics')) item.cancel();
    });
    if (dev) window.loadURL('http://127.0.0.1:5173');
    else window.loadFile(path.join(__dirname, '../dist/index.html'));
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    const image = existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
      : nativeImage.createEmpty();
    tray = new Tray(image);
    tray.setToolTip('PartyUp — уведомления включены, пока приложение в трее');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть PartyUp', click: show },
        { type: 'separator' },
        {
          label: 'Завершить работу',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('double-click', show);
    timer = setInterval(() => {
      void poll();
    }, 5000);
  });
}
function show(eventId) {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (typeof eventId === 'string' && eventId) window.webContents.send('open-event', eventId);
}
function trusted(event) {
  return (
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}
function notification(data) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: String(data.title).slice(0, 120),
    body: String(data.body).slice(0, 500),
    icon: iconPath,
  });
  n.on('click', () => show(data.eventId));
  n.show();
}
async function poll(baseline = false) {
  if (!connection || inFlight) return;
  inFlight = true;
  const current = connection,
    epoch = generation;
  try {
    const response = await fetch(`${current.origin}/api/state`, {
      headers: { Authorization: `Bearer ${current.token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401) {
      if (epoch === generation) connection = null;
      return;
    }
    if (!response.ok) return;
    const state = await response.json();
    if (epoch !== generation) return;
    for (const notice of [...state.notifications].reverse()) {
      if (!seen.has(notice.id) && !baseline && !current.baseline && !notice.is_read)
        notification({ title: notice.title, body: notice.body, eventId: notice.event_id });
      seen.add(notice.id);
    }
    current.baseline = false;
    if (seen.size > 2000) {
      const ids = [...seen];
      for (const id of ids.slice(0, ids.length - 1000)) seen.delete(id);
    }
  } catch {
  } finally {
    inFlight = false;
  }
}
ipcMain.handle('token:get', (event) => {
  if (!trusted(event)) return null;
  try {
    return safeStorage.decryptString(readFileSync(credentialFile()));
  } catch {
    return null;
  }
});
ipcMain.handle('token:set', (event, token) => {
  if (!trusted(event) || typeof token !== 'string' || token.length > 1024)
    throw new Error('Invalid request');
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Защищённое хранилище Windows недоступно');
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(credentialFile(), safeStorage.encryptString(token));
});
ipcMain.handle('token:clear', (event) => {
  if (!trusted(event)) return;
  if (existsSync(credentialFile())) unlinkSync(credentialFile());
});
ipcMain.handle('autostart', (event, enabled) => {
  if (!trusted(event) || typeof enabled !== 'boolean') return;
  if (!app.isPackaged) throw new Error('Автозапуск доступен после установки Windows-сборки');
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: [],
  });
});
ipcMain.on('connect', (event, data) => {
  if (!trusted(event) || typeof data?.token !== 'string') return;
  try {
    const origin = new URL(data.origin);
    if (
      origin.protocol !== 'https:' &&
      !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))
    )
      return;
    if (origin.username || origin.password) return;
    if (connection?.token === data.token && connection?.origin === origin.origin) return;
    generation++;
    seen.clear();
    connection = { origin: origin.origin, token: data.token, baseline: true };
    void poll(true);
  } catch {}
});
ipcMain.on('disconnect', (event) => {
  if (!trusted(event)) return;
  generation++;
  connection = null;
  seen.clear();
});
ipcMain.on('notify', (event, data) => {
  if (trusted(event) && data && typeof data.title === 'string' && typeof data.body === 'string')
    notification(data);
});
app.on('before-quit', () => {
  quitting = true;
  clearInterval(timer);
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
