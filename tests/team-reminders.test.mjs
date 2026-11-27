import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../server/app.mjs';

async function fixture(push) {
  const app = createApplication({ dataDir: ':memory:', demo: true, push });
  await app.seed();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const request = async (path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };
  const tokens = {};
  for (const username of ['demo', 'nikita', 'anya', 'max'])
    tokens[username] = (
      await request('/api/auth/login', '', { username, password: 'partyup-demo' })
    ).token;
  const { id } = await request('/api/events', tokens.demo, {
    game: 'Командная игра',
    starts_at: new Date(Date.now() + 10 * 60000).toISOString(),
    timezone: 'Europe/Moscow',
    friends: ['demo-nikita', 'demo-anya', 'demo-max'],
  });
  return { app, request, tokens, id };
}

test('team reminders wait for pending and declined guests, then respect personal lead times and deduplication', async () => {
  const { app, request, tokens, id } = await fixture();
  const count = () => app.store.get('SELECT COUNT(*) n FROM reminders WHERE event_id=?', id).n;
  const reply = (user, status) => request(`/api/events/${id}/reply`, tokens[user], { status });
  try {
    await request('/api/preferences', tokens.nikita, { alarmEnabled: true, alarmMinutes: 5 });
    await request('/api/preferences', tokens.max, { alarmEnabled: false, alarmMinutes: 15 });
    app.remind();
    assert.equal(count(), 0, 'host must wait for guests');
    await reply('nikita', 'accepted');
    await reply('anya', 'declined');
    app.remind();
    assert.equal(count(), 0, 'pending and declined guests both block the team');
    await reply('max', 'accepted');
    app.remind();
    assert.equal(count(), 0, 'one refusal still blocks all reminders');
    assert.equal(
      app.store.get("SELECT COUNT(*) n FROM notifications WHERE event_id=? AND kind='reminder'", id)
        .n,
      0,
    );
    await reply('anya', 'accepted');
    app.remind();
    app.remind();
    assert.equal(count(), 2, 'only host and Anya are due and enabled');
    assert.equal(
      app.store.get('SELECT 1 FROM reminders WHERE event_id=? AND user_id=?', id, 'demo-nikita'),
      undefined,
    );
    await request('/api/preferences', tokens.nikita, { alarmEnabled: true, alarmMinutes: 15 });
    app.remind();
    app.remind();
    assert.equal(count(), 3, 'later personal alarm is sent once');
    assert.equal(
      app.store.get("SELECT COUNT(*) n FROM notifications WHERE event_id=? AND kind='reminder'", id)
        .n,
      3,
    );
  } finally {
    app.close();
  }
});

test('push rechecks the whole team before initial delivery and after a failed attempt', async () => {
  for (const status of ['pending', 'declined']) {
    let attempts = 0;
    const { app, request, tokens, id } = await fixture(async (_tokens, notice) => {
      if (notice.kind === 'reminder') {
        attempts++;
        throw new Error('Temporary transport failure');
      }
      return [];
    });
    try {
      await request('/api/devices', tokens.demo, {
        token: 'team-reminder-device',
        platform: 'android',
      });
      for (const user of ['nikita', 'anya', 'max'])
        await request(`/api/events/${id}/reply`, tokens[user], { status: 'accepted' });
      app.remind();
      assert.equal(app.store.get('SELECT COUNT(*) n FROM reminders WHERE event_id=?', id).n, 4);
      if (status === 'declined') {
        await app.flushPush();
        assert.equal(attempts, 1);
        app.store.run('UPDATE push_outbox SET next_attempt=0');
      }
      app.store.run(
        'UPDATE participants SET status=? WHERE event_id=? AND user_id=?',
        status,
        id,
        'demo-anya',
      );
      const before = attempts;
      await app.flushPush();
      assert.equal(attempts, before, 'another guest changing their mind blocks the host push too');
      assert.equal(
        app.store.get(
          "SELECT COUNT(*) n FROM push_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.event_id=? AND n.kind='reminder'",
          id,
        ).n,
        0,
      );
    } finally {
      app.close();
    }
  }
});
