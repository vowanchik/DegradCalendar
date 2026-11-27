// Run after package:win; checks the actual portable executable with an isolated profile.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expectedScript = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').match(
  /src="\.\/assets\/([^"]+\.js)"/,
)[1];
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(
  resolve(`release/PartyUp-${version}-Windows.exe`),
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${resolve('test-results/packaged-smoke-profile')}`,
  ],
  { stdio: 'ignore', windowsHide: true },
);
let browser, page;
async function connect(url) {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    const waiter = pending.get(data.id);
    if (waiter) {
      pending.delete(data.id);
      if (data.error) waiter.reject(new Error(JSON.stringify(data.error)));
      else waiter.resolve(data.result);
    }
  });
  return {
    ws,
    call: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        ws.send(JSON.stringify({ id: key, method, params }));
      }),
  };
}
try {
  const until = Date.now() + 30000;
  let info, targets;
  while (Date.now() < until) {
    try {
      info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(info?.webSocketDebuggerUrl, 'Portable app did not start');
  browser = await connect(info.webSocketDebuggerUrl);
  page = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let result;
  do {
    result = await page.call('Runtime.evaluate', {
      expression:
        "JSON.stringify({url:location.href, bridge:Boolean(window.partyup), auth:Boolean(document.querySelector('.auth')), title:document.title, script:document.querySelector('script[type=module]')?.src})",
      returnByValue: true,
    });
    if (JSON.parse(result.result.value).auth) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < until);
  const state = JSON.parse(result.result.value);
  assert.equal(state.auth, true);
  assert.equal(state.bridge, true);
  assert.ok(state.url.includes('app.asar/dist/index.html'));
  assert.match(state.title, /PartyUp/);
  assert.ok(
    state.script.endsWith('/assets/' + expectedScript),
    'EXE must contain the current production bundle',
  );
  console.log(
    'PASS: portable EXE starts, loads packaged production UI and native bridge in an isolated profile',
  );
} finally {
  if (browser)
    await Promise.race([
      browser.call('Browser.close').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  page?.ws.close();
  browser?.ws.close();
  child.kill();
}
