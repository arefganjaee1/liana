import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(dataDir, 'liana.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

// اسکلت اولیه — جدول‌های واقعی (مشتری‌ها، نوبت‌ها، امتیازها) بعداً اضافه می‌شن
db.exec(`
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
if (!row) {
  db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '0');
}
