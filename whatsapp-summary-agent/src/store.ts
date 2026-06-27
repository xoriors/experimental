import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export interface StoredMessage {
  sender: string;
  senderName: string;
  body: string;
  ts: number; // unix seconds
}

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    group_jid   TEXT NOT NULL,
    sender      TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    body        TEXT NOT NULL,
    ts          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_group_ts ON messages (group_jid, ts);
`);

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO messages (id, group_jid, sender, sender_name, body, ts)
   VALUES (@id, @groupJid, @sender, @senderName, @body, @ts)`,
);

const sinceStmt = db.prepare(
  `SELECT sender, sender_name AS senderName, body, ts
   FROM messages
   WHERE group_jid = @groupJid AND ts >= @since
   ORDER BY ts ASC`,
);

const pruneStmt = db.prepare(`DELETE FROM messages WHERE ts < @cutoff`);

export function insertMessage(row: {
  id: string;
  groupJid: string;
  sender: string;
  senderName: string;
  body: string;
  ts: number;
}): void {
  insertStmt.run(row);
}

export function getMessagesSince(groupJid: string, sinceUnix: number): StoredMessage[] {
  return sinceStmt.all({ groupJid, since: sinceUnix }) as StoredMessage[];
}

/** Delete messages older than RETENTION_DAYS. Returns rows removed. */
export function pruneOld(): number {
  const cutoff = Math.floor(Date.now() / 1000) - config.retentionDays * 86400;
  return pruneStmt.run({ cutoff }).changes;
}
