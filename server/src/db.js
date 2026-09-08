import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(dataDir, 'liana.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- پرسنل (فعلاً فقط دکتر فرناز، بعداً هرکی اضافه شد همینجا میاد)
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',        -- 'owner' | 'staff'
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ساعاتِ کاریِ هفتگیِ هر پرسنل (تکرارشونده، هفته به هفته)
  CREATE TABLE IF NOT EXISTS staff_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL,                  -- 0=یکشنبه ... 6=شنبه
    is_off INTEGER NOT NULL DEFAULT 0,
    start_time TEXT,                           -- 'HH:MM'
    end_time TEXT,                             -- 'HH:MM'
    UNIQUE(staff_id, weekday)
  );

  -- خدمات
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    category TEXT,
    price INTEGER,                             -- تومان؛ NULL یعنی «قیمت بعد از مشاوره»
    duration_minutes INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- variantِ هر خدمت (مثلاً بوتاکسِ رگولار / دیسپورت)
  CREATE TABLE IF NOT EXISTS service_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    price INTEGER,                             -- NULL = از قیمتِ خودِ خدمت استفاده کن
    duration_minutes INTEGER,                  -- NULL = از مدت‌زمانِ خودِ خدمت استفاده کن
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  -- عکس‌های هر خدمت
  CREATE TABLE IF NOT EXISTS service_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                        -- 'sample' | 'before' | 'after' | 'equipment'
    pair_key TEXT,                             -- برای جفت‌کردنِ قبل/بعدِ مرتبط (مثلاً 'pair1')
    filename TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- کدوم پرسنل کدوم خدمت رو انجام می‌ده
  CREATE TABLE IF NOT EXISTS service_staff (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, staff_id)
  );

  -- نوبت‌ها (دفترچه‌ی رزرو دستیِ پذیرش — رزروِ واقعی هنوز از طریقِ پیامک میاد، پذیرش همینجا ثبتش می‌کنه)
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    service_title TEXT NOT NULL,               -- عنوانِ خدمت لحظه‌ی ثبت؛ حتی اگه بعداً خدمت عوض/حذف بشه تاریخچه درست می‌مونه
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    staff_name TEXT,                           -- اسمِ پرسنل لحظه‌ی ثبت (همون منطقِ بالا)
    booking_date TEXT NOT NULL,                -- 'YYYY-MM-DD' میلادی (فرانت شمسی نمایش می‌ده)
    booking_time TEXT,                         -- 'HH:MM'
    status TEXT NOT NULL DEFAULT 'confirmed',  -- 'pending' | 'confirmed' | 'done' | 'cancelled'
    note TEXT,
    created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);

  -- حساب‌های پنل (ادمین/منیجر)
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager',      -- 'admin' | 'manager'
    display_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
if (!row) {
  db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '1');
} else if (row.value !== '1') {
  db.prepare('UPDATE _meta SET value = ? WHERE key = ?').run('1', 'schema_version');
}

// اگه هنوز هیچ پرسنلی نیست، دکتر فرناز رو به‌عنوانِ صاحب/پرسنلِ اول می‌سازیم
const staffCount = db.prepare('SELECT COUNT(*) AS c FROM staff').get().c;
if (staffCount === 0) {
  db.prepare(`INSERT INTO staff (name, role, active, sort_order) VALUES (?, 'owner', 1, 0)`).run('دکتر فرناز گنجایی');
}
