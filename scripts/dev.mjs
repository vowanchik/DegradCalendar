import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
const run = (file, args, env = {}) => {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && !stopping) stop(code);
  });
  return child;
};
let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
run('server/index.mjs', [], { DEMO_MODE: 'true' });
run('node_modules/vite/bin/vite.js', []);
if (process.argv.includes('--desktop')) {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch('http://127.0.0.1:5173')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  run('node_modules/electron/cli.js', ['.'], { PARTYUP_DEV: 'true' });
}
