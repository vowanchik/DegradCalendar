import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function createStore(directory) {
  if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(
    directory === ':memory:' ? directory : join(directory, 'partyup.sqlite'),
  );
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, friend_code TEXT UNIQUE NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS friends(user_id TEXT NOT NULL REFERENCES users(id), friend_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(user_id,friend_id));
    CREATE TABLE IF NOT EXISTS friend_requests(id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(sender_id,recipient_id));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, game TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL, notes TEXT NOT NULL, location TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants(event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('accepted','pending','declined')), PRIMARY KEY(event_id,user_id));
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), platform TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_outbox(id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES notifications(id), attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS reminders(event_id TEXT NOT NULL, user_id TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(event_id,user_id,version));
    CREATE INDEX IF NOT EXISTS participants_user ON participants(user_id);
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
    CREATE INDEX IF NOT EXISTS messages_event ON messages(event_id,created_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return { db, get, all, run, transaction };
}
