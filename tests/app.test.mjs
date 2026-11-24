import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/app.mjs';
import { calendarFile } from '../server/calendar.mjs';
const app = createApplication({ dataDir: ':memory:' });
let base;
before(async () => {
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());
async function request(path, token, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : await response.text(),
  };
}
let alice, bob, outsider, eventId;
test('register, hash sessions and passwords, reject bad credentials and disabled demo', async () => {
  alice = (
    await request('/api/auth/register', null, {
      username: 'alice',
      name: 'Алиса',
      password: 'password-123',
    })
  ).body;
  bob = (
    await request('/api/auth/register', null, {
      username: 'bob',
      name: 'Борис',
      password: 'password-123',
    })
  ).body;
  outsider = (
    await request('/api/auth/register', null, {
      username: 'outsider',
      name: 'Другой',
      password: 'password-123',
    })
  ).body;
  assert.equal((await request('/api/state')).status, 401);
  assert.equal(
    (await request('/api/auth/login', null, { username: 'alice', password: 'incorrect' })).status,
    401,
  );
  assert.equal(
    (
      await request('/api/auth/register', null, {
        username: 'alice',
        name: 'Копия',
        password: 'password-123',
      })
    ).status,
    409,
  );
  assert.equal((await request('/api/auth/demo', null, {})).status, 404);
  assert.equal(
    app.store.get('SELECT hash FROM sessions WHERE user_id=?', alice.user.id).hash,
    await import('node:crypto').then((c) =>
      c.createHash('sha256').update(alice.token).digest('hex'),
    ),
  );
  assert.notEqual(
    app.store.get('SELECT password FROM users WHERE id=?', alice.user.id).password,
    'password-123',
  );
});
test('friend requests require recipient approval', async () => {
  assert.equal(
    (await request('/api/friends', alice.token, { code: bob.user.friend_code })).status,
    201,
  );
  assert.equal((await request('/api/state', alice.token)).body.friends.length, 0);
  const b = (await request('/api/state', bob.token)).body;
  const id = b.requests[0].id;
  assert.equal(
    (await request(`/api/friends/requests/${id}`, outsider.token, { accept: true })).status,
    404,
  );
  assert.equal(
    (await request(`/api/friends/requests/${id}`, alice.token, { accept: true })).status,
    404,
  );
  assert.equal(
    (await request(`/api/friends/requests/${id}`, bob.token, { accept: true })).status,
    200,
  );
  assert.equal((await request('/api/state', alice.token)).body.friends[0].id, bob.user.id);
  assert.equal((await request('/api/state', bob.token)).body.friends[0].id, alice.user.id);
});
const eventBody = () => ({
  title: 'Тестовый игровой вечер',
  game: 'Minecraft',
  starts_at: new Date(Date.now() + 10 * 60000).toISOString(),
  ends_at: new Date(Date.now() + 120 * 60000).toISOString(),
  timezone: 'Europe/Moscow',
  notes: 'Проверка календаря, чата; и приглашений',
  friends: [bob.user.id],
});
test('create only with friends, isolate private events and notify participants', async () => {
  assert.equal(
    (await request('/api/events', alice.token, { ...eventBody(), friends: [outsider.user.id] }))
      .status,
    400,
  );
  assert.equal(
    (await request('/api/events', alice.token, { ...eventBody(), timezone: 'No/Zone' })).status,
    400,
  );
  assert.equal(
    (await request('/api/events', alice.token, { ...eventBody(), starts_at: 'broken' })).status,
    400,
  );
  const result = await request('/api/events', alice.token, eventBody());
  assert.equal(result.status, 201);
  eventId = result.body.id;
  const b = (await request('/api/state', bob.token)).body;
  assert.equal(b.events[0].my_status, 'pending');
  assert.equal(b.notifications.filter((n) => n.kind === 'invite').length, 1);
  assert.equal((await request('/api/state', outsider.token)).body.events.length, 0);
  for (const action of ['messages', 'calendar'])
    assert.equal((await request(`/api/events/${eventId}/${action}`, outsider.token)).status, 404);
  assert.equal((await request(`/api/events/${eventId}/calendar`, bob.token)).status, 403);
});
test('RSVP is idempotent, calendar uses UTC, messages are private and cancellation requires host', async () => {
  assert.equal(
    (await request(`/api/events/${eventId}/reply`, bob.token, { status: 'accepted' })).status,
    200,
  );
  assert.equal(
    (await request(`/api/events/${eventId}/reply`, bob.token, { status: 'accepted' })).status,
    200,
  );
  const a = (await request('/api/state', alice.token)).body;
  assert.equal(a.notifications.filter((n) => n.kind === 'reply').length, 1);
  const file = await request(`/api/events/${eventId}/calendar`, bob.token);
  assert.equal(file.status, 200);
  assert.match(file.body, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(file.body, /TRIGGER:-PT15M/);
  const message = '<script>alert("xss")</script>';
  assert.equal(
    (await request(`/api/events/${eventId}/messages`, bob.token, { text: message })).status,
    201,
  );
  assert.equal(
    (await request(`/api/events/${eventId}/messages`, alice.token)).body[0].text,
    message,
  );
  assert.equal(
    (await request(`/api/events/${eventId}/messages`, outsider.token, { text: 'spying' })).status,
    404,
  );
  assert.equal((await request(`/api/events/${eventId}/cancel`, bob.token, {})).status, 403);
  assert.equal((await request(`/api/events/${eventId}/cancel`, alice.token, {})).status, 200);
  assert.equal(
    (await request(`/api/events/${eventId}/reply`, bob.token, { status: 'accepted' })).status,
    409,
  );
  assert.equal(
    (await request(`/api/events/${eventId}/messages`, bob.token, { text: 'too late' })).status,
    409,
  );
  assert.match(
    (await request(`/api/events/${eventId}/calendar`, alice.token)).body,
    /STATUS:CANCELLED/,
  );
});
test('reminders persist and do not duplicate; cancelled events do not remind', async () => {
  const result = await request('/api/events', alice.token, eventBody());
  const id = result.body.id;
  await request(`/api/events/${id}/reply`, bob.token, { status: 'accepted' });
  app.remind();
  app.remind();
  assert.equal(app.store.get('SELECT COUNT(*) n FROM reminders WHERE event_id=?', id).n, 2);
  assert.equal(
    app.store.get("SELECT COUNT(*) n FROM notifications WHERE event_id=? AND kind='reminder'", id)
      .n,
    2,
  );
  assert.equal(app.store.get('SELECT COUNT(*) n FROM reminders WHERE event_id=?', eventId).n, 0);
});
test('logout revokes session and removes only the current device', async () => {
  await request('/api/devices', bob.token, {
    token: 'test-fcm-token-device-one',
    platform: 'android',
  });
  await request('/api/devices', bob.token, { token: 'test-fcm-token-device-two', platform: 'ios' });
  assert.equal(
    (await request('/api/auth/logout', bob.token, { deviceToken: 'test-fcm-token-device-one' }))
      .status,
    200,
  );
  assert.equal((await request('/api/state', bob.token)).status, 401);
  assert.equal(app.store.all('SELECT * FROM devices WHERE user_id=?', bob.user.id).length, 1);
});
test('calendar escapes text injection and folds UTF-8 lines to 75 octets', () => {
  const file = calendarFile({
    id: 'test',
    game: 'Игра'.repeat(100),
    title: 'name,semi;slash\\\nEND:VEVENT',
    starts_at: '2026-12-01T17:00Z',
    ends_at: '2026-12-01T19:00Z',
    created_at: '2026-11-24T10:00Z',
    notes: 'line1\nline2',
  });
  assert.ok(file.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(file.split('\r\n').filter((l) => l === 'END:VEVENT').length, 1);
  assert.match(file, /DESCRIPTION:line1\\nline2/);
});
test('persisted push outbox retries errors and drops invalid tokens', async () => {
  let fail = true;
  const calls = [];
  const delivery = createApplication({
    dataDir: ':memory:',
    demo: true,
    push: async (tokens, data) => {
      calls.push(data);
      if (fail) throw Object.assign(new Error('temporary'), { code: 'test-temporary' });
      return tokens;
    },
  });
  try {
    await delivery.seed();
    delivery.store.run(
      'INSERT INTO devices VALUES(?,?,?,?)',
      'invalid-token',
      'demo-user',
      'android',
      new Date().toISOString(),
    );
    await delivery.flushPush();
    assert.equal(delivery.store.get('SELECT attempts FROM push_outbox').attempts, 1);
    delivery.store.run('UPDATE push_outbox SET next_attempt=0');
    fail = false;
    await delivery.flushPush();
    assert.equal(delivery.store.all('SELECT * FROM push_outbox').length, 0);
    assert.equal(delivery.store.all('SELECT * FROM devices').length, 0);
    assert.equal(calls.length, 2);
  } finally {
    delivery.close();
  }
});
