const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  safeStorage,
  nativeImage,
  screen,
} = require('electron');
const { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { serverOrigin } = require('./server-origin.cjs');
const { badgeBitmap } = require('./tray-badge.cjs');
let window, widget, audioWindow, tray, baseIcon, timer, configuration, latest;
let quitting = false,
  connection = null,
  inFlight = false,
  generation = 0,
  pendingEvent = '';
const seen = new Set(),
  audioRequests = new Map();
const kinds = ['invite', 'reply', 'decline', 'message', 'friend', 'cancel', 'reminder'];
const dev = process.env.PARTYUP_DEV === 'true';
const iconPath = path.join(__dirname, '../dist/assets/logo.png');
const credentialFile = () => path.join(app.getPath('userData'), 'session.enc');
const configFile = () => path.join(app.getPath('userData'), 'desktop.json');
let saved = {};
function persist() {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(saved));
}
function harden(target) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', (event, url) => {
    if (url !== target.webContents.getURL()) event.preventDefault();
  });
}
function loadApp(target) {
  if (dev) return target.loadURL('http://127.0.0.1:5173');
  return target.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.partyup.app');
  app.on('second-instance', () => show());
  app.whenReady().then(() => {
    try {
      saved = JSON.parse(readFileSync(configFile(), 'utf8'));
    } catch {}
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
    harden(window);
    window.webContents.session.on('will-download', (_event, item) => item.cancel());
    window.webContents.on('did-finish-load', () => {
      if (pendingEvent) {
        window.webContents.send('open-event', pendingEvent);
        pendingEvent = '';
      }
    });
    void loadApp(window);
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    baseIcon = existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
      : nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4), { width: 32, height: 32 });
    tray = new Tray(baseIcon);
    updateTray(0);
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
    timer = setInterval(() => void poll(), 5000);
  });
}
function show(eventId) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (typeof eventId === 'string' && eventId) {
    if (window.webContents.isLoadingMainFrame()) pendingEvent = eventId;
    else window.webContents.send('open-event', eventId);
  }
}
function trusted(event, target = window) {
  return (
    target &&
    !target.isDestroyed() &&
    event.sender === target.webContents &&
    event.senderFrame === target.webContents.mainFrame
  );
}
function updateTray(count) {
  if (!tray || tray.isDestroyed()) return;
  const unread = Math.max(0, Math.floor(count));
  tray.setImage(
    unread
      ? nativeImage.createFromBitmap(badgeBitmap(baseIcon.toBitmap(), unread), {
          width: 32,
          height: 32,
        })
      : baseIcon,
  );
  tray.setToolTip(
    unread ? `PartyUp — непрочитанных уведомлений: ${unread}` : 'PartyUp — новых уведомлений нет',
  );
  if (window && !window.isDestroyed())
    window.setOverlayIcon(
      unread
        ? nativeImage.createFromBitmap(badgeBitmap(Buffer.alloc(32 * 32 * 4), unread), {
            width: 32,
            height: 32,
          })
        : null,
      `Непрочитанных: ${unread}`,
    );
}
function widgetState() {
  return {
    events: latest?.events || [],
    zone: configuration?.zone || 'Europe/Moscow',
    theme: configuration?.preferences.theme || 'forest',
    connected: Boolean(latest && connection && !connection.offline),
  };
}
function updateWidget() {
  if (!connection || !configuration?.preferences.widgetEnabled) {
    if (widget && !widget.isDestroyed()) widget.destroy();
    widget = null;
    return;
  }
  if (!widget || widget.isDestroyed()) {
    const work = screen.getPrimaryDisplay().workArea;
    const bounds = saved.widgetBounds;
    const visible =
      bounds &&
      screen
        .getAllDisplays()
        .some(
          (display) =>
            bounds.x >= display.workArea.x &&
            bounds.y >= display.workArea.y &&
            bounds.x + 380 <= display.workArea.x + display.workArea.width &&
            bounds.y + 560 <= display.workArea.y + display.workArea.height,
        );
    widget = new BrowserWindow({
      width: 380,
      height: 560,
      ...(visible
        ? { x: bounds.x, y: bounds.y }
        : { x: work.x + work.width - 400, y: work.y + 24 }),
      frame: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      title: 'Календарь PartyUp',
      backgroundColor: '#101316',
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, 'widget-preload.cjs'),
        partition: 'partyup-widget',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    harden(widget);
    widget.on('page-title-updated', (event) => event.preventDefault());
    widget.once('ready-to-show', () => widget?.showInactive());
    widget.on('moved', () => {
      if (widget && !widget.isDestroyed()) {
        saved.widgetBounds = widget.getBounds();
        persist();
      }
    });
    widget.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        hideWidget();
      }
    });
    void loadApp(widget);
  } else widget.webContents.send('widget-state', widgetState());
}
function hideWidget() {
  if (!configuration) return;
  configuration.preferences.widgetEnabled = false;
  saved[configuration.scope] = {
    ...saved[configuration.scope],
    preferences: configuration.preferences,
    zone: configuration.zone,
  };
  persist();
  updateWidget();
  window?.webContents.send('preferences', configuration.preferences);
}
async function requestAudio(action, source) {
  if (!source.startsWith('data:')) source = pathToFileURL(source).href;
  if (!audioWindow || audioWindow.isDestroyed()) {
    audioWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'audio-preload.cjs'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    harden(audioWindow);
    await audioWindow.loadFile(path.join(__dirname, 'audio.html'));
  } else if (audioWindow.webContents.isLoadingMainFrame())
    await new Promise((resolve) => audioWindow.webContents.once('did-finish-load', resolve));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      audioRequests.delete(id);
      reject(new Error('Не удалось воспроизвести звук'));
    }, 8000);
    audioRequests.set(id, { resolve, reject, timeout });
    audioWindow.webContents.send('audio-request', { id, action, source });
  });
}
ipcMain.on('audio-result', (event, data) => {
  if (!trusted(event, audioWindow)) return;
  const pending = audioRequests.get(data?.id);
  if (!pending) return;
  audioRequests.delete(data.id);
  clearTimeout(pending.timeout);
  if (data.error) pending.reject(new Error(String(data.error)));
  else pending.resolve();
});
function soundPath(kind) {
  const sound = saved[configuration?.scope]?.sounds?.[kind];
  return sound && /^[a-f0-9]{64}\.(wav|mp3|ogg|m4a|caf|aiff?)$/.test(sound.file)
    ? path.join(app.getPath('userData'), 'sounds', sound.file)
    : null;
}
async function notification(data) {
  const epoch = generation;
  const custom = soundPath(data.kind);
  let silent = false;
  if (custom) {
    try {
      await requestAudio('play', custom);
      silent = true;
    } catch {}
  }
  if (epoch !== generation) return;
  if (!Notification.isSupported()) return;
  const notice = new Notification({
    title: String(data.title).slice(0, 120),
    body: String(data.body).slice(0, 500),
    icon: iconPath,
    silent,
  });
  notice.on('click', () => show(data.eventId));
  notice.show();
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
    if (epoch !== generation) return;
    if (response.status === 401) {
      disconnect();
      return;
    }
    if (!response.ok) throw new Error('Offline');
    const state = await response.json();
    if (epoch !== generation) return;
    latest = state;
    current.offline = false;
    const scope = `${current.origin}:${state.user.id}`;
    if (configuration?.scope !== scope) {
      const stored = saved[scope];
      configuration = {
        scope,
        zone: stored?.zone || 'Europe/Moscow',
        preferences: stored?.preferences || { theme: 'forest', widgetEnabled: false, sounds: {} },
      };
    }
    updateTray(state.unreadCount ?? state.notifications.filter((n) => !n.is_read).length);
    updateWidget();
    for (const notice of [...state.notifications].reverse()) {
      if (!seen.has(notice.id) && !baseline && !current.baseline && !notice.is_read) {
        const event = state.events.find((e) => e.id === notice.event_id);
        if (
          notice.kind !== 'reminder' ||
          (state.preferences?.alarmEnabled !== false &&
            event &&
            !event.cancelled &&
            event.my_status === 'accepted' &&
            Date.parse(event.starts_at) > Date.now())
        )
          void notification({
            title: notice.title,
            body: notice.body,
            eventId: notice.event_id,
            kind: notice.kind,
          });
      }
      seen.add(notice.id);
    }
    current.baseline = false;
    if (seen.size > 2000) for (const id of [...seen].slice(0, seen.size - 1000)) seen.delete(id);
  } catch {
    if (epoch === generation) {
      current.offline = true;
      updateWidget();
    }
  } finally {
    inFlight = false;
  }
}
function disconnect() {
  if (window && !window.isDestroyed()) window.webContents.setZoomFactor(1);
  generation++;
  connection = null;
  configuration = null;
  latest = null;
  seen.clear();
  updateTray(0);
  updateWidget();
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
  if (trusted(event) && existsSync(credentialFile())) unlinkSync(credentialFile());
});
ipcMain.handle('autostart', (event, enabled) => {
  if (!trusted(event) || typeof enabled !== 'boolean') return;
  if (!app.isPackaged) throw new Error('Автозапуск доступен в Windows-сборке');
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: [],
  });
});
ipcMain.handle('configure', (event, data) => {
  if (
    !trusted(event) ||
    !connection ||
    typeof data?.scope !== 'string' ||
    data.scope.length > 1000 ||
    !data.scope.startsWith(connection.origin + ':')
  )
    throw new Error('Нет активной сессии');
  if (latest && data.scope !== `${connection.origin}:${latest.user.id}`)
    throw new Error('Сессия изменилась');
  new Intl.DateTimeFormat('ru', { timeZone: data.zone }).format();
  const prefs = data.preferences;
  if (
    !['forest', 'ocean', 'violet', 'light'].includes(prefs?.theme) ||
    typeof prefs.widgetEnabled !== 'boolean'
  )
    throw new Error('Неверные настройки');
  configuration = {
    scope: data.scope,
    zone: data.zone,
    preferences: {
      theme: prefs.theme,
      widgetEnabled: prefs.widgetEnabled,
      hideInactive: prefs.hideInactive === true,
      zoom: [100, 110, 125, 150, 175, 200].includes(prefs.zoom) ? prefs.zoom : 100,
      sounds: prefs.sounds || {},
    },
  };
  saved[data.scope] = {
    ...saved[data.scope],
    zone: data.zone,
    preferences: configuration.preferences,
  };
  persist();
  window.webContents.setZoomFactor(configuration.preferences.zoom / 100);
  updateWidget();
});
ipcMain.handle('sound:set', async (event, data) => {
  if (!trusted(event) || !configuration || !kinds.includes(data?.kind))
    throw new Error('Неверный запрос');
  const scope = configuration.scope,
    epoch = generation;
  const account = (saved[scope] ||= {});
  account.sounds ||= {};
  if (data.reset === true) {
    delete account.sounds[data.kind];
    persist();
    return null;
  }
  if (
    typeof data.name !== 'string' ||
    data.name.length > 200 ||
    typeof data.dataUrl !== 'string' ||
    data.dataUrl.length > 2800000 ||
    !/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(data.dataUrl)
  )
    throw new Error('Выберите звуковой файл до 2 МБ');
  const extension = path.extname(data.name).toLowerCase();
  if (!['.wav', '.mp3', '.ogg', '.m4a', '.caf', '.aif', '.aiff'].includes(extension))
    throw new Error('Неподдерживаемый формат звука');
  await requestAudio('validate', data.dataUrl);
  if (epoch !== generation || configuration?.scope !== scope) throw new Error('Сессия изменилась');
  const buffer = Buffer.from(data.dataUrl.split(',')[1], 'base64');
  const file =
    createHash('sha256').update(scope).update(data.kind).update(buffer).digest('hex') + extension;
  const directory = path.join(app.getPath('userData'), 'sounds');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, file), buffer);
  account.sounds[data.kind] = { name: data.name, file };
  persist();
  return { name: data.name };
});
ipcMain.handle('sound:preview', async (event, kind) => {
  if (!trusted(event) || !kinds.includes(kind)) throw new Error('Неверный запрос');
  const source = soundPath(kind);
  if (source) await requestAudio('play', source);
  else
    await notification({
      title: 'PartyUp · проверка звука',
      body: 'Стандартное уведомление Windows',
    });
});
ipcMain.handle('widget:get', (event) => {
  if (trusted(event, widget)) return widgetState();
});
ipcMain.on('widget:open', (event, id) => {
  if (trusted(event, widget) && latest?.events.some((e) => e.id === id)) show(id);
});
ipcMain.on('widget:hide', (event) => {
  if (trusted(event, widget)) hideWidget();
});
ipcMain.on('connect', (event, data) => {
  if (!trusted(event) || typeof data?.token !== 'string' || data.token.length > 1024) return;
  try {
    const origin = serverOrigin(data.origin);
    if (connection?.token === data.token && connection?.origin === origin) return;
    disconnect();
    connection = { origin, token: data.token, baseline: true };
    void poll(true);
  } catch {}
});
ipcMain.on('disconnect', (event) => {
  if (trusted(event)) disconnect();
});
ipcMain.on('notify', (event, data) => {
  if (trusted(event) && typeof data?.title === 'string' && typeof data.body === 'string')
    void notification(data);
});
app.on('before-quit', () => {
  quitting = true;
  clearInterval(timer);
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
