import { mkdirSync, copyFileSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const target = resolve(`release/PartyUp-${version}-Server`);
if (existsSync(target)) throw new Error(`Staging directory already exists: ${target}`);
mkdirSync(join(target, 'scripts'), { recursive: true });
cpSync('server', join(target, 'server'), { recursive: true });
for (const file of [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.env.example',
  '.env.http.example',
  'Start-Server.vbs',
  'Stop-Server.vbs',
])
  copyFileSync(file, join(target, file));
copyFileSync('scripts/backup.mjs', join(target, 'scripts/backup.mjs'));
copyFileSync('scripts/server-windows.ps1', join(target, 'scripts/server-windows.ps1'));
copyFileSync('docs/SERVER.md', join(target, 'SERVER.md'));
copyFileSync('docs/MOBILE-PUSH.md', join(target, 'MOBILE-PUSH.md'));
console.log(target);
