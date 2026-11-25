import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createSteamSearch } from '../server/steam.mjs';

async function fixture(options = {}) {
  const app = createApplication({ dataDir: ':memory:', demo: true, ...options });
  await app.seed();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  async function request(path, token, body) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const login = async (username, password = 'partyup-demo') =>
    request('/api/auth/login', null, { username, password });
  return {
    app,
    request,
    login,
    host: (await login('demo')).body.token,
    guest: (await login('nikita')).body.token,
  };
}

test('meetings need only game, start and friends; no two-hour duration or description', async () => {
  const { app, request, host } = await fixture();
  try {
    const body = {
      game: 'Counter-Strike 2',
      steam_app_id: 730,
      starts_at: new Date(Date.now() + 600000).toISOString(),
      timezone: 'Europe/Moscow',
      friends: ['demo-nikita'],
    };
    for (const starts_at of [
      null,
      'invalid',
      new Date(Date.now() - 60000).toISOString(),
      new Date(Date.now() + 367 * 86400000).toISOString(),
    ])
      assert.equal((await request('/api/events', host, { ...body, starts_at })).status, 400);
    assert.equal(
      (await request('/api/events', host, { ...body, steam_app_id: '../evil' })).status,
      400,
    );
    const result = await request('/api/events', host, body);
    assert.equal(result.status, 201);
    const event = app.store.get('SELECT * FROM events WHERE id=?', result.body.id);
    assert.equal(event.title, body.game);
    assert.equal(event.notes, '');
    assert.equal(event.ends_at, event.starts_at);
    assert.equal(event.steam_app_id, 730);
  } finally {
    app.close();
  }
});

test('reschedule is host-only, keeps chat, resets RSVP, clears old alarms and re-arms reminders', async () => {
  const { app, request, host, guest } = await fixture();
  try {
    const event = app.store.get("SELECT * FROM events WHERE host_id='demo-user'");
    app.store.run(
      'UPDATE events SET starts_at=? WHERE id=?',
      new Date(Date.now() + 120000).toISOString(),
      event.id,
    );
    app.remind();
    assert.ok(
      app.store.get("SELECT id FROM notifications WHERE event_id=? AND kind='reminder'", event.id),
    );
    const chatBefore = app.store.all('SELECT * FROM messages WHERE event_id=?', event.id);
    const body = {
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      timezone: 'Asia/Yekaterinburg',
      version: event.version,
    };
    assert.equal((await request(`/api/events/${event.id}/reschedule`, guest, body)).status, 403);
    assert.equal(
      (await request(`/api/events/${event.id}/reschedule`, host, { ...body, version: 20 })).status,
      409,
    );
    assert.equal(
      (await request(`/api/events/${event.id}/reschedule`, host, { ...body, starts_at: 'bad' }))
        .status,
      400,
    );
    assert.equal((await request(`/api/events/${event.id}/reschedule`, host, body)).status, 200);
    const updated = app.store.get('SELECT * FROM events WHERE id=?', event.id);
    assert.equal(updated.starts_at, body.starts_at);
    assert.equal(updated.version, event.version + 1);
    assert.equal(updated.timezone, body.timezone);
    assert.deepEqual(
      app.store.all('SELECT * FROM messages WHERE event_id=?', event.id),
      chatBefore,
    );
    assert.equal(
      app.store.get(
        'SELECT status FROM participants WHERE event_id=? AND user_id=?',
        event.id,
        'demo-nikita',
      ).status,
      'pending',
    );
    assert.equal(
      app.store.get(
        'SELECT status FROM participants WHERE event_id=? AND user_id=?',
        event.id,
        'demo-user',
      ).status,
      'accepted',
    );
    assert.equal(
      app.store.get(
        "SELECT COUNT(*) n FROM notifications WHERE event_id=? AND kind='reminder'",
        event.id,
      ).n,
      0,
    );
    assert.match(
      (await request('/api/state', guest)).body.notifications[0].body,
      /подтвердите участие заново/,
    );
    assert.equal((await request(`/api/events/${event.id}/reschedule`, host, body)).status, 409);
    assert.equal(
      (
        await request(`/api/events/${event.id}/reschedule`, host, {
          ...body,
          version: updated.version,
        })
      ).status,
      200,
    );
    assert.equal(
      app.store.get('SELECT version FROM events WHERE id=?', event.id).version,
      updated.version,
    );
    app.store.run(
      'UPDATE events SET starts_at=? WHERE id=?',
      new Date(Date.now() + 120000).toISOString(),
      event.id,
    );
    app.remind();
    assert.equal(
      app.store.get(
        'SELECT COUNT(*) n FROM reminders WHERE event_id=? AND version=?',
        event.id,
        updated.version,
      ).n,
      1,
    );
    await request(`/api/events/${event.id}/reply`, guest, { status: 'accepted' });
    app.remind();
    app.remind();
    assert.equal(
      app.store.get(
        'SELECT COUNT(*) n FROM reminders WHERE event_id=? AND version=?',
        event.id,
        updated.version,
      ).n,
      2,
    );
    await request(`/api/events/${event.id}/cancel`, host, {});
    assert.equal(
      (
        await request(`/api/events/${event.id}/reschedule`, host, {
          ...body,
          version: updated.version + 1,
        })
      ).status,
      409,
    );
  } finally {
    app.close();
  }
});

test('profile updates propagate avatars and names; password requires proof and revokes other sessions', async () => {
  const { app, request, host, guest, login } = await fixture();
  try {
    const avatar =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=';
    const other = (await login('demo')).body.token;
    assert.equal((await request('/api/profile', host, { name: 'Новое имя', avatar })).status, 200);
    assert.equal((await request('/api/state', host)).body.user.avatar, avatar);
    assert.equal(
      (await request('/api/state', guest)).body.friends.find((u) => u.id === 'demo-user').name,
      'Новое имя',
    );
    assert.equal(
      (await request('/api/state', guest)).body.events
        .flatMap((e) => e.participants)
        .find((p) => p.id === 'demo-user').avatar,
      avatar,
    );
    for (const value of [
      'data:image/svg+xml;base64,PHN2Zy8+',
      'https://evil.example/image.png',
      'data:image/png;base64,AAAA',
      'data:image/png;base64,' + Buffer.alloc(129 * 1024).toString('base64'),
    ])
      assert.equal(
        (await request('/api/profile', host, { name: 'Имя', avatar: value })).status,
        400,
      );
    assert.equal(
      (
        await request('/api/profile', host, {
          name: 'Имя',
          newPassword: 'new-password',
          currentPassword: 'wrong-pass',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/profile', host, {
          name: 'Имя',
          newPassword: 'short',
          currentPassword: 'partyup-demo',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/api/profile', host, {
          name: 'Новое имя',
          avatar: '',
          newPassword: 'new-password',
          currentPassword: 'partyup-demo',
        })
      ).status,
      200,
    );
    assert.equal((await request('/api/state', host)).status, 200);
    assert.equal((await request('/api/state', host)).body.user.avatar, '');
    assert.equal((await request('/api/state', other)).status, 401);
    assert.equal((await login('demo')).status, 401);
    assert.equal((await login('demo', 'new-password')).status, 200);
    assert.equal((await request('/api/state', guest)).status, 200);
  } finally {
    app.close();
  }
});

test('clear notifications deletes only this account and its queued deliveries, preserving invitations and reminder deduplication', async () => {
  const { app, request, host, guest } = await fixture();
  try {
    const event = app.store.get("SELECT id FROM events WHERE host_id='demo-user'");
    app.store.run(
      'UPDATE events SET starts_at=? WHERE id=?',
      new Date(Date.now() + 120000).toISOString(),
      event.id,
    );
    app.remind();
    const others = (await request('/api/state', guest)).body.notifications;
    const events = (await request('/api/state', host)).body.events;
    assert.equal((await request('/api/notifications/clear', null, {})).status, 401);
    assert.equal((await request('/api/notifications/clear', host, {})).status, 200);
    app.remind();
    const state = (await request('/api/state', host)).body;
    assert.equal(state.notifications.length, 0);
    assert.equal(state.unreadCount, 0);
    assert.deepEqual(state.events, events);
    assert.deepEqual((await request('/api/state', guest)).body.notifications, others);
    assert.equal(
      app.store.get(
        "SELECT COUNT(*) n FROM push_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.user_id='demo-user'",
      ).n,
      0,
    );
    assert.equal((await request('/api/notifications/clear', host, {})).status, 200);
  } finally {
    app.close();
  }
});

test('Steam search is authenticated, validates queries, uses cache and reports upstream failure', async () => {
  let calls = 0;
  const search = createSteamSearch(async (url, options) => {
    calls++;
    assert.equal(url.hostname, 'store.steampowered.com');
    assert.equal(url.searchParams.get('term'), 'Counter');
    assert.ok(options.signal);
    return Response.json({
      items: [
        { type: 'app', id: 730, name: 'Counter-Strike 2' },
        { id: 'bad', name: 'Bad' },
      ],
    });
  });
  assert.deepEqual(await search('Counter'), [{ id: 730, name: 'Counter-Strike 2' }]);
  await search('counter');
  assert.equal(calls, 1);
  const { app, request, host } = await fixture({ steamSearch: search });
  try {
    assert.equal((await request('/api/steam/search?q=Counter')).status, 401);
    assert.equal((await request('/api/steam/search?q=a', host)).status, 400);
    assert.equal((await request('/api/steam/search?q=Counter', host)).body[0].id, 730);
  } finally {
    app.close();
  }
  const failing = await fixture({
    steamSearch: async () => {
      throw new Error('timeout');
    },
  });
  try {
    assert.equal((await failing.request('/api/steam/search?q=Counter', failing.host)).status, 502);
  } finally {
    failing.app.close();
  }
});

test('existing 0.2.0 database migrates repeatedly without changing accounts or meetings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'partyup-migration-'));
  try {
    const db = new DatabaseSync(join(dir, 'partyup.sqlite'));
    db.exec(
      "CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,name TEXT,password TEXT,friend_code TEXT UNIQUE,color TEXT,created_at TEXT); INSERT INTO users VALUES('old','old','Имя','hash','CODE','#fff','date'); CREATE TABLE events(id TEXT PRIMARY KEY,host_id TEXT,title TEXT,game TEXT,starts_at TEXT,ends_at TEXT,timezone TEXT,notes TEXT,location TEXT,cancelled INTEGER DEFAULT 0,version INTEGER DEFAULT 0,created_at TEXT); INSERT INTO events VALUES('meeting','old','Вечер','Игра','start','end','Europe/Moscow','','Онлайн',0,0,'date');",
    );
    db.close();
    for (let i = 0; i < 2; i++) {
      const store = createStore(dir);
      assert.equal(store.get('SELECT avatar FROM users WHERE id=?', 'old').avatar, '');
      assert.equal(
        store.get('SELECT steam_app_id FROM events WHERE id=?', 'meeting').steam_app_id,
        null,
      );
      assert.equal(store.get('SELECT title FROM events WHERE id=?', 'meeting').title, 'Вечер');
      store.db.close();
    }
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), 'partyup-migration-')));
    rmSync(dir, { recursive: true, force: true });
  }
});
