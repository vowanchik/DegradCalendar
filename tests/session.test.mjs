import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/app.mjs';

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

test('server address accepts remote HTTP and HTTPS and normalizes the origin', () => {
  for (const [address, expected] of [
    ['http://192.168.1.50:3001/', 'http://192.168.1.50:3001'],
    ['http://203.0.113.10:3001', 'http://203.0.113.10:3001'],
    ['http://[2001:db8::1]:3001', 'http://[2001:db8::1]:3001'],
    [' HTTP://Party.Example.com:80/ ', 'http://party.example.com'],
    ['https://party.example.com/', 'https://party.example.com'],
  ]) {
    client.setServerUrl(address);
    assert.equal(client.serverUrl(), expected);
  }
});

test('invalid server addresses do not replace the selected server', () => {
  const previous = client.serverUrl();
  for (const address of [
    '203.0.113.10:3001',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://party.example.com',
    'http://alice:secret@party.example.com',
    'http://party.example.com/api',
    'http://party.example.com/?token=secret',
    'http://party.example.com/#session',
  ]) {
    assert.throws(() => client.setServerUrl(address));
    assert.equal(client.serverUrl(), previous);
  }
});

test('HTTP session is restored for the selected server and connects desktop notifications', async () => {
  const originalConnect = window.partyup.connect;
  let connection;
  try {
    window.partyup.connect = (value) => (connection = value);
    await client.clearToken();
    client.setServerUrl('http://203.0.113.10:3001');
    await client.saveToken('http-session');
    assert.equal(await client.loadToken(), 'http-session');
    assert.deepEqual(connection, {
      origin: 'http://203.0.113.10:3001',
      token: 'http-session',
    });
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://203.0.113.10:3001/api/state');
      assert.equal(options.headers.Authorization, 'Bearer http-session');
      return new Response(JSON.stringify({ user: { name: 'Друг' } }));
    };
    assert.deepEqual(await client.api('/api/state'), { user: { name: 'Друг' } });
    client.setServerUrl('https://203.0.113.10:3001');
    assert.equal(await client.loadToken(), '');
  } finally {
    window.partyup.connect = originalConnect;
  }
});

test('HTTP client registers, loads private state and logs out through a real server', async () => {
  const app = createApplication({ dataDir: ':memory:' });
  try {
    // This loopback address exercises the same path as remote HTTP; it was not allowlisted.
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.2', resolve);
    });
    globalThis.fetch = originalFetch;
    await client.clearToken();
    client.setServerUrl(`http://127.0.0.2:${app.server.address().port}`);
    const session = await client.api('/api/auth/register', {
      username: 'httpfriend',
      name: 'Друг по HTTP',
      password: 'http-test-only-password',
    });
    assert.ok(session.token);
    await client.saveToken(session.token);
    assert.equal(await client.loadToken(), session.token);
    const state = await client.api('/api/state');
    assert.equal(state.user.name, 'Друг по HTTP');
    await client.revokeSession();
    await assert.rejects(client.api('/api/state'), (error) => error.status === 401);
    await client.clearToken();
    assert.equal(await client.loadToken(), '');
  } finally {
    app.close();
    globalThis.fetch = originalFetch;
  }
});
