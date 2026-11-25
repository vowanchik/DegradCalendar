import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createApplication } from '../server/app.mjs';

const require = createRequire(import.meta.url);
const app = createApplication({
  dataDir: ':memory:',
  demo: true,
  steamSearch: async () => [{ id: 730, name: 'Counter-Strike 2' }],
});
try {
  await app.seed();
  app.store.run("UPDATE events SET steam_app_id=730 WHERE host_id='demo-user'");
  app.store.run("UPDATE events SET cancelled=1 WHERE host_id='demo-anya'");
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(`${origin}/api/auth/demo`, { method: 'POST' });
  const { token } = await response.json();
  const child = spawn(require('electron'), ['tests/ui-smoke.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, PARTYUP_TEST_ORIGIN: origin, PARTYUP_TEST_TOKEN: token },
  });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  app.close();
}
