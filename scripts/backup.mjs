import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const directory = resolve(process.env.DATA_DIR || './data');
const backups = join(directory, 'backups');
mkdirSync(backups, { recursive: true });
const filename = join(backups, `partyup-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
const db = new DatabaseSync(join(directory, 'partyup.sqlite'));
try {
  db.prepare('VACUUM INTO ?').run(filename);
  console.log(filename);
} finally {
  db.close();
}
