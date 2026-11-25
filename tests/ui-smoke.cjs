const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const profile = path.resolve(__dirname, '../test-results/ui-smoke-profile');
app.setPath('userData', profile);
app.setName('PartyUp UI smoke');
app.on('browser-window-created', (_event, target) =>
  target.once('ready-to-show', () => target.hide()),
);
const origin = process.env.PARTYUP_TEST_ORIGIN,
  token = process.env.PARTYUP_TEST_TOKEN;
const waitFor = async (fn) => {
  const until = Date.now() + 15000;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error('Timed out waiting for UI');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
app
  .whenReady()
  .then(async () => {
    require('../desktop/main.cjs');
    await waitFor(() => BrowserWindow.getAllWindows().length);
    const main = BrowserWindow.getAllWindows()[0];
    const js = (code) => main.webContents.executeJavaScript(code);
    const wait = (code) => waitFor(() => js(code));
    const click = (text) =>
      js(
        `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('Missing button: ' + ${JSON.stringify(text)}); b.click(); })()`,
      );
    const input = (selector, value) =>
      js(
        `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
    const snapshot = async (name) => {
      main.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
      fs.writeFileSync(
        path.resolve(__dirname, `../test-results/${name}.png`),
        (await main.webContents.capturePage()).toPNG(),
      );
      main.hide();
    };
    await wait('Boolean(window.partyup)');
    await js(
      `localStorage.clear(); localStorage.setItem('partyup.server', ${JSON.stringify(origin)}); window.partyup.setToken(${JSON.stringify(JSON.stringify({ origin, token }))})`,
    );
    main.reload();
    await wait("Boolean(document.querySelector('.app-shell'))");
    await wait("document.querySelectorAll('.event-card').length > 0");
    const alignment = await js(
      `(() => { const a = document.querySelector('.search svg').getBoundingClientRect(), b = document.querySelector('.search input').getBoundingClientRect(); return Math.abs(a.y+a.height/2-b.y-b.height/2); })()`,
    );
    assert.ok(alignment < 1, `Search icon is off center: ${alignment}`);
    await snapshot('030-calendar');
    await click('Создать встречу');
    await wait("Boolean(document.querySelector('#game-search'))");
    assert.equal(
      await js(
        "Boolean(document.querySelector('input[name=title], textarea[name=notes], input[name=ends_at]'))",
      ),
      false,
    );
    await input('#game-search', 'Counter');
    await wait("document.querySelectorAll('.steam-results [role=option]').length === 1");
    await click('Counter-Strike 2Steam');
    await js("document.querySelector('.friend-picker input').click()");
    await input('input[name=date]', new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    await snapshot('030-create');
    await click('Отправить приглашения');
    await wait("Boolean(document.querySelector('.detail-layout'))");
    assert.equal(
      await js("document.querySelector('.detail-facts').textContent.includes('–')"),
      false,
    );
    await click('Изменить время');
    await input('.reschedule-form input[name=time]', '21:30');
    await click('Сохранить время');
    await wait(
      "!document.querySelector('.reschedule-form') && document.querySelector('.detail-facts').textContent.includes('21:30')",
    );
    await snapshot('030-detail');
    await js("document.querySelector('button[aria-label=Закрыть]').click()");
    await js("document.querySelector('.inactive-filter input').click()");
    assert.equal(
      await js(
        `JSON.parse(localStorage.getItem('partyup.preferences:' + ${JSON.stringify(origin)} + ':demo-user')).hideInactive`,
      ),
      true,
    );
    await click('Настройки');
    await wait("Boolean(document.querySelector('.profile-form'))");
    await input('.profile-form input[autocomplete=name]', 'Саша QA');
    const avatarBytes = fs
      .readFileSync(path.resolve(__dirname, '../public/assets/logo.png'))
      .toString('base64');
    await js(
      `(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(avatarBytes)}), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'avatar.png', {type:'image/png'})); const e = document.querySelector('.profile-form input[type=file]'); e.files = dt.files; e.dispatchEvent(new Event('change', {bubbles:true})); })()`,
    );
    await wait(
      "Boolean(document.querySelector('.profile-avatar-controls img')) && !document.querySelector('.profile-form button[type=submit], .profile-form > button').disabled",
    );
    await click('Сохранить профиль');
    await wait("document.querySelector('.sidebar-profile strong').textContent === 'Саша QA'");
    assert.ok(
      await js(
        "document.querySelector('.sidebar-profile .avatar img').src.startsWith('data:image/png;base64,')",
      ),
    );
    await js(
      "const z = document.querySelector('select[aria-label=\"Масштаб интерфейса\"]'); z.value = '150'; z.dispatchEvent(new Event('change', { bubbles: true }));",
    );
    await waitFor(() => main.webContents.getZoomFactor() === 1.5);
    await snapshot('030-settings-150');
    main.reload();
    await wait("Boolean(document.querySelector('.app-shell'))");
    await waitFor(() => main.webContents.getZoomFactor() === 1.5);
    assert.equal(await js("document.querySelector('.inactive-filter input').checked"), true);
    await js("document.querySelector('button[title=Уведомления]').click()");
    await click('Очистить список');
    await click('Удалить все');
    await wait(
      "document.querySelector('.notification-popover .empty h3')?.textContent === 'Всё спокойно'",
    );
    await snapshot('030-notifications-cleared');
    // Check the same app at a narrow, mobile-sized viewport.
    main.webContents.setZoomFactor(1);
    await main.setMinimumSize(360, 620);
    await main.setSize(390, 844);
    await js('document.querySelector(\'button[aria-label="Закрыть уведомления"]\').click()');
    await wait("Boolean(document.querySelector('.mobile-nav'))");
    await snapshot('030-narrow');
    console.log(
      'PASS: production UI creates Steam meeting without description/end, reschedules, edits profile, persists zoom/filter, clears notifications and centers search icon',
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
setTimeout(() => {
  console.error('UI smoke timed out');
  app.exit(2);
}, 90000);
