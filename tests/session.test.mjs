import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}
let savedToken = null;
let disconnected = 0;
let failStorageClear = false;
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.window = {
  partyup: {
    getToken: async () => savedToken,
    setToken: async (value) => {
      savedToken = value;
    },
    clearToken: async () => {
      if (failStorageClear) throw new Error('storage unavailable');
      savedToken = null;
    },
    disconnect: () => disconnected++,
    connect: () => {},
  },
};
const client = await import('../src/api.ts');
const { logoutPush } = await import('../src/integrations.ts');
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(async () => {
  localStorage.clear();
  savedToken = null;
  disconnected = 0;
  failStorageClear = false;
  client.setServerUrl('https://old.example.com');
  await client.saveToken('old-session');
});

test('offline logout clears local credentials immediately without awaiting server revocation', async () => {
  let remote;
  globalThis.fetch = (url, options) =>
    new Promise((resolve, reject) => {
      remote = { url, options, reject };
    });
  assert.equal(logoutPush(), undefined);
  await client.clearToken();
  assert.equal(savedToken, null);
  assert.equal(disconnected, 1);
  assert.equal(await client.loadToken(), '');
  assert.equal(remote.url, 'https://old.example.com/api/auth/logout');
  assert.equal(remote.options.headers.Authorization, 'Bearer old-session');
  client.setServerUrl('https://new.example.com');
  assert.equal(client.serverUrl(), 'https://new.example.com');
  // The best-effort request retains the old address and credentials after switching servers.
  assert.equal(remote.url, 'https://old.example.com/api/auth/logout');
  remote.reject(new TypeError('offline'));
});

test('server errors do not prevent local logout', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  logoutPush();
  await client.clearToken();
  assert.equal(savedToken, null);
  assert.equal(await client.loadToken(), '');
});

test('logout aborts in-flight requests and a late response cannot restore the old session', async () => {
  let deliver;
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => {
      deliver = resolve;
    });
  };
  const pending = client.api('/api/state');
  const stale = assert.rejects(pending, client.SessionChangedError);
  await client.clearToken();
  assert.equal(signal.aborted, true);
  deliver(new Response(JSON.stringify({ user: { name: 'Old account' } })));
  await stale;
  assert.equal(await client.loadToken(), '');
});

test('late unauthorized response from the old server does not revoke a new session', async () => {
  let deliver;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const old = client.api('/api/state');
  const stale = assert.rejects(old, client.SessionChangedError);
  await client.clearToken();
  client.setServerUrl('https://new.example.com');
  await client.saveToken('new-session');
  deliver(new Response(JSON.stringify({ error: 'Old session expired' }), { status: 401 }));
  await stale;
  assert.equal(await client.loadToken(), 'new-session');
});

test('local logout marker prevents restoring a credential if native cleanup fails', async () => {
  failStorageClear = true;
  await assert.rejects(client.clearToken(), /storage unavailable/);
  assert.ok(savedToken);
  assert.equal(await client.loadToken(), '');
  failStorageClear = false;
  await client.saveToken('replacement-session');
  assert.equal(await client.loadToken(), 'replacement-session');
});

test('logout during startup cannot restore a delayed credential from native storage', async () => {
  const original = window.partyup.getToken;
  const previous = savedToken;
  let deliver;
  try {
    window.partyup.getToken = () =>
      new Promise((resolve) => {
        deliver = resolve;
      });
    const loading = client.loadToken();
    await client.clearToken();
    deliver(previous);
    assert.equal(await loading, '');
    assert.equal(await client.loadToken(), '');
  } finally {
    window.partyup.getToken = original;
  }
});
