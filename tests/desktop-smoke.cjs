// Runs with Electron, in an isolated profile and with an in-memory API fixture.
const { app, BrowserWindow, Tray } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const profile = path.resolve(__dirname, '../test-results/desktop-smoke-profile');
app.setPath('userData', profile);
app.setName('PartyUp desktop smoke');
let tooltip = '';
const setToolTip = Tray.prototype.setToolTip;
Tray.prototype.setToolTip = function (text) {
  tooltip = text;
  return setToolTip.call(this, text);
};
app.on('browser-window-created', (_event, target) =>
  target.once('ready-to-show', () => target.hide()),
);
const origin = 'http://127.0.0.1:31999';
const event = {
  id: 'fixture-event',
  title: 'Тестовая встреча',
  game: 'Тестовая игра',
  starts_at: new Date(Date.now() + 3600000).toISOString(),
  ends_at: new Date(Date.now() + 7200000).toISOString(),
  my_status: 'pending',
  cancelled: 0,
  participants: [],
};
let state = {
  user: { id: 'fixture-user' },
  events: [event],
  notifications: [],
  unreadCount: 143,
  preferences: { alarmEnabled: true, alarmMinutes: 15 },
};
global.fetch = async () => new Response(JSON.stringify(state), { status: 200 });
const waitFor = async (predicate) => {
  const until = Date.now() + 12000;
  while (!(await predicate())) {
    if (Date.now() > until) throw new Error('Timed out waiting for desktop state');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
function wav() {
  const bytes = Buffer.alloc(44 + 12000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(22050, 24);
  bytes.writeUInt32LE(44100, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(12000, 40);
  for (let i = 0; i < 6000; i++)
    bytes.writeInt16LE(Math.round(800 * Math.sin((2 * Math.PI * 660 * i) / 22050)), 44 + 2 * i);
  return bytes;
}
app
  .whenReady()
  .then(async () => {
    require('../desktop/main.cjs');
    await waitFor(() => BrowserWindow.getAllWindows().length > 0);
    const main = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => {
      if (main.webContents.isLoadingMainFrame()) main.webContents.once('did-finish-load', resolve);
      else resolve();
    });
    const invoke = (method, data) =>
      main.webContents.executeJavaScript(`window.partyup.${method}(${JSON.stringify(data)})`);
    await invoke('connect', { origin, token: 'fixture-session' });
    await waitFor(() => tooltip.includes('143'));
    const config = {
      scope: `${origin}:fixture-user`,
      zone: 'Europe/Moscow',
      preferences: { theme: 'ocean', widgetEnabled: true, sounds: {} },
    };
    await invoke('configure', config);
    await waitFor(() =>
      BrowserWindow.getAllWindows().some(
        (window) => window !== main && window.getTitle() === 'Календарь PartyUp',
      ),
    );
    const widget = BrowserWindow.getAllWindows().find(
      (window) => window !== main && window.getTitle() === 'Календарь PartyUp',
    );
    await new Promise((resolve) => {
      if (widget.webContents.isLoadingMainFrame())
        widget.webContents.once('did-finish-load', resolve);
      else resolve();
    });
    const snapshot = await widget.webContents.executeJavaScript('window.partyupWidget.getState()');
    assert.equal(snapshot.events[0].id, event.id);
    assert.equal(snapshot.theme, 'ocean');
    assert.equal(snapshot.zone, 'Europe/Moscow');
    assert.equal(await widget.webContents.executeJavaScript('typeof window.partyup'), 'undefined');
    console.log('PASS: widget highlights event data without exposing the session bridge');
    const choice = await invoke('setSound', {
      kind: 'reminder',
      name: 'test.wav',
      dataUrl: 'data:audio/wav;base64,' + wav().toString('base64'),
    });
    assert.equal(choice.name, 'test.wav');
    await invoke('previewSound', 'reminder');
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'desktop.json'), 'utf8'));
    assert.ok(
      fs.existsSync(path.join(profile, 'sounds', saved[config.scope].sounds.reminder.file)),
    );
    assert.equal(saved[config.scope].sounds.invite, undefined);
    assert.equal(await invoke('setSound', { kind: 'reminder', reset: true }), null);
    await assert.rejects(
      invoke('setSound', {
        kind: 'reminder',
        name: 'bad.wav',
        dataUrl: 'data:audio/wav;base64,AAAA',
      }),
    );
    console.log(
      'PASS: WAV import, durable storage, playback, per-kind selection, reset, invalid audio rejection',
    );
    state = { ...state, unreadCount: 0 };
    await waitFor(() => tooltip.includes('новых уведомлений нет'));
    console.log('PASS: tray unread count updates and clears');
    await widget.webContents.executeJavaScript('window.partyupWidget.hide()');
    await waitFor(() => widget.isDestroyed());
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(profile, 'desktop.json'), 'utf8'))[config.scope]
        .preferences.widgetEnabled,
      false,
    );
    console.log('PASS: closing the widget persists its disabled state');
    await invoke('configure', config);
    const reopened = BrowserWindow.getAllWindows().find(
      (window) => window !== main && window.getTitle() === 'Календарь PartyUp',
    );
    await new Promise((resolve) => {
      if (reopened.webContents.isLoadingMainFrame())
        reopened.webContents.once('did-finish-load', resolve);
      else resolve();
    });
    await main.webContents.executeJavaScript(
      "window.qaOpened = ''; window.partyup.onOpen(id => { window.qaOpened = id; }); true",
    );
    await reopened.webContents.executeJavaScript(
      `window.partyupWidget.openEvent(${JSON.stringify(event.id)})`,
    );
    await waitFor(
      async () => (await main.webContents.executeJavaScript('window.qaOpened')) === event.id,
    );
    console.log('PASS: widget opens the selected invitation in the main window');
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
setTimeout(() => {
  console.error('Desktop smoke timed out');
  app.exit(2);
}, 45000);
