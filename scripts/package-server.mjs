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
])
  copyFileSync(file, join(target, file));
copyFileSync('scripts/backup.mjs', join(target, 'scripts/backup.mjs'));
copyFileSync('docs/SERVER.md', join(target, 'SERVER.md'));
console.log(target);
