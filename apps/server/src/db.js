import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const uid = (prefix = 'r') => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
export const now = () => new Date().toISOString();
export const day = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function need(value, message = '缺少必要信息') {
  if (!value) throw new AppError(400, 'VALIDATION', message);
  return value;
}
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const raw = new DatabaseSync(filename);
  raw.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT,created TEXT NOT NULL,updated TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,type TEXT NOT NULL,item_id TEXT,item_type TEXT,duration REAL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS config_versions(version INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL,actor TEXT,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quota_charges(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,buyer_id TEXT NOT NULL,day TEXT NOT NULL,UNIQUE(company_id,buyer_id,day));
  `);
  return {
    raw,
    get(kind, id) {
      const r = raw.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
      return r ? JSON.parse(r.data) : null;
    },
    list(kind) {
      return raw
        .prepare('SELECT data FROM records WHERE kind=? ORDER BY created DESC,id')
        .all(kind)
        .map((r) => JSON.parse(r.data));
    },
    save(kind, value) {
      const item = {
        ...value,
        id: value.id || uid(kind),
        updatedAt: now(),
        createdAt: value.createdAt || now()
      };
      raw
        .prepare(
          'INSERT INTO records(kind,id,owner,created,updated,data) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET owner=excluded.owner,updated=excluded.updated,data=excluded.data'
        )
        .run(
          kind,
          item.id,
          item.ownerId || item.authorId || item.companyId || null,
          item.createdAt,
          item.updatedAt,
          JSON.stringify(item)
        );
      return item;
    },
    remove(kind, id) {
      return raw.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
    },
    transaction(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      raw.close();
    }
  };
}
export function audit(db, user, action, target, detail = {}) {
  db.save('audit', {
    id: uid('audit'),
    actorId: user?.id || 'system',
    actor: user?.name || '系统',
    action,
    target,
    detail
  });
}
