import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/app.mjs';
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
  assert.equal((await request(`/api/events/${eventId}/calendar`, bob.token)).status, 404);
});
test('RSVP is idempotent, messages are private and cancellation requires host', async () => {
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
  assert.equal((await request(`/api/events/${eventId}/calendar`, bob.token)).status, 404);
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
  assert.equal((await request(`/api/events/${eventId}/calendar`, alice.token)).status, 404);
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
test('personal alarms support custom lead time, disabling, validation, and user isolation', async () => {
  assert.deepEqual((await request('/api/state', alice.token)).body.preferences, {
    alarmEnabled: true,
    alarmMinutes: 15,
  });
  for (const invalid of [-1, 0, 1.5, 10081, '30', null])
    assert.equal(
      (
        await request('/api/preferences', alice.token, {
          alarmEnabled: true,
          alarmMinutes: invalid,
        })
      ).status,
      400,
    );
  assert.equal(
    (await request('/api/preferences', alice.token, { alarmEnabled: 'true', alarmMinutes: 30 }))
      .status,
    400,
  );
  await request('/api/preferences', alice.token, { alarmEnabled: true, alarmMinutes: 90 });
  await request('/api/preferences', bob.token, { alarmEnabled: false, alarmMinutes: 45 });
  const created = await request('/api/events', alice.token, {
    ...eventBody(),
    starts_at: new Date(Date.now() + 60 * 60000).toISOString(),
  });
  await request(`/api/events/${created.body.id}/reply`, bob.token, { status: 'accepted' });
  app.remind();
  app.remind();
  assert.equal(
    app.store.get(
      'SELECT COUNT(*) n FROM reminders WHERE event_id=? AND user_id=?',
      created.body.id,
      alice.user.id,
    ).n,
    1,
  );
  assert.equal(
    app.store.get(
      'SELECT COUNT(*) n FROM reminders WHERE event_id=? AND user_id=?',
      created.body.id,
      bob.user.id,
    ).n,
    0,
  );
  assert.deepEqual((await request('/api/state', bob.token)).body.preferences, {
    alarmEnabled: false,
    alarmMinutes: 45,
  });
  await request('/api/preferences', bob.token, { alarmEnabled: true, alarmMinutes: 120 });
  app.remind();
  assert.equal(
    app.store.get(
      'SELECT COUNT(*) n FROM reminders WHERE event_id=? AND user_id=?',
      created.body.id,
      bob.user.id,
    ).n,
    1,
  );
});
test('refusals produce a distinct notification and mark only the selected notice read', async () => {
  const result = await request('/api/events', alice.token, eventBody());
  await request(`/api/events/${result.body.id}/reply`, bob.token, { status: 'declined' });
  await request(`/api/events/${result.body.id}/reply`, bob.token, { status: 'declined' });
  const declines = (await request('/api/state', alice.token)).body.notifications.filter(
    (n) => n.kind === 'decline' && n.event_id === result.body.id,
  );
  assert.equal(declines.length, 1);
  assert.match(declines[0].body, /Борис: отказался от участия/);
  const foreign = (await request('/api/state', bob.token)).body.notifications.find(
    (n) => !n.is_read,
  );
  await request('/api/notifications/read', alice.token, { id: foreign.id });
  assert.equal(
    app.store.get('SELECT is_read FROM notifications WHERE id=?', foreign.id).is_read,
    0,
  );
  await request('/api/notifications/read', alice.token, { id: declines[0].id });
  assert.equal(
    app.store.get('SELECT is_read FROM notifications WHERE id=?', declines[0].id).is_read,
    1,
  );
  assert.ok((await request('/api/state', alice.token)).body.notifications.some((n) => !n.is_read));
});
test('device sound preferences are scoped to a token and reject arbitrary paths', async () => {
  const token = 'test-custom-sounds-device';
  const sounds = {
    invite: { channelId: 'partyup-invite-abcd1234' },
    reminder: { soundName: 'partyup-abcd1234.wav' },
  };
  assert.equal(
    (await request('/api/devices', alice.token, { token, platform: 'android', sounds })).status,
    200,
  );
  assert.deepEqual(
    JSON.parse(app.store.get('SELECT sounds FROM device_sounds WHERE token=?', token).sounds),
    sounds,
  );
  assert.equal(
    (
      await request('/api/devices', bob.token, {
        token: 'another-test-device-token',
        platform: 'ios',
        sounds: { invite: { soundName: '../secret.wav' } },
      })
    ).status,
    400,
  );
  await request('/api/devices/remove', bob.token, { token });
  assert.ok(app.store.get('SELECT * FROM devices WHERE token=?', token));
  await request('/api/devices/remove', alice.token, { token });
  assert.equal(app.store.get('SELECT * FROM device_sounds WHERE token=?', token), undefined);
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
test('push uses per-device sounds and drops alarms after cancellation or refusal', async () => {
  const delivered = [];
  const delivery = createApplication({
    dataDir: ':memory:',
    demo: true,
    push: async (tokens, data) => {
      delivered.push({ tokens, ...data });
      return [];
    },
  });
  try {
    await delivery.seed();
    const store = delivery.store;
    store.run(
      'INSERT INTO devices VALUES(?,?,?,?)',
      'custom-device-token',
      'demo-user',
      'android',
      new Date().toISOString(),
    );
    store.run(
      'INSERT INTO device_sounds VALUES(?,?)',
      'custom-device-token',
      JSON.stringify({ reminder: { channelId: 'partyup-reminder-custom' } }),
    );
    const event = store.get('SELECT id FROM events WHERE host_id=?', 'demo-user');
    store.run(
      'UPDATE events SET starts_at=? WHERE id=?',
      new Date(Date.now() + 60000).toISOString(),
      event.id,
    );
    delivery.remind();
    await delivery.flushPush();
    const alarm = delivered.find((n) => n.kind === 'reminder');
    assert.ok(alarm);
    assert.equal(
      alarm.deviceSounds['custom-device-token'].reminder.channelId,
      'partyup-reminder-custom',
    );
    assert.ok(alarm.notificationId);
    delivered.length = 0;
    store.run('DELETE FROM reminders WHERE event_id=?', event.id);
    delivery.remind();
    store.run('UPDATE events SET cancelled=1 WHERE id=?', event.id);
    await delivery.flushPush();
    assert.equal(delivered.filter((n) => n.kind === 'reminder').length, 0);
    store.run('UPDATE events SET cancelled=0 WHERE id=?', event.id);
    store.run('DELETE FROM reminders WHERE event_id=?', event.id);
    delivery.remind();
    store.run(
      "UPDATE participants SET status='declined' WHERE event_id=? AND user_id=?",
      event.id,
      'demo-user',
    );
    await delivery.flushPush();
    assert.equal(delivered.filter((n) => n.kind === 'reminder').length, 0);
  } finally {
    delivery.close();
  }
});
