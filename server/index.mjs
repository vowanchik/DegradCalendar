import { createApplication } from './app.mjs';
let push = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  initializeApp({ credential: applicationDefault() });
  push = async (tokens, data) => {
    const result = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: data.title, body: data.body },
      data: { eventId: data.eventId, notificationId: data.notificationId },
      android: {
        priority: 'high',
        notification: { channelId: 'partyup', icon: 'ic_stat_partyup' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const dead = [];
    result.responses.forEach((r, i) => {
      if (
        [
          'messaging/registration-token-not-registered',
          'messaging/invalid-registration-token',
        ].includes(r.error?.code)
      )
        dead.push(tokens[i]);
    });
    if (
      result.responses.some(
        (r) =>
          r.error &&
          ![
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token',
          ].includes(r.error.code),
      )
    )
      throw new Error('FCM delivery failed');
    return dead;
  };
}
const app = createApplication({
  dataDir: process.env.DATA_DIR || './data',
  demo: process.env.DEMO_MODE === 'true',
  appOrigin: process.env.APP_ORIGIN || '',
  push,
});
await app.seed();
const port = Number(process.env.PORT || 3001),
  host = process.env.HOST || '127.0.0.1';
app.server.listen(port, host, () =>
  console.log(
    `PartyUp API: http://${host}:${port} · push ${push ? 'configured' : 'not configured'}${process.env.DEMO_MODE === 'true' ? ' · LOCAL DEMO' : ''}`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    app.close();
    process.exit(0);
  });
