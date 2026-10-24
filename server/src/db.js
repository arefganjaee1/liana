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

export const dbFilePath = dbPath;
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

  -- استثنایِ یه‌روزه‌یِ ساعتِ کاری (مرخصی/تعطیلیِ غیرِتکرارشونده) — برایِ فازِ رزروِ آنلاین
  CREATE TABLE IF NOT EXISTS staff_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date TEXT NOT NULL,                        -- 'YYYY-MM-DD' میلادی
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(staff_id, date)
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

  -- مشتری‌ها (CRM — پروفایلِ ماندگارِ هر مشتری، جدا از رکوردِ لحظه‌ایِ هر نوبت)
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,                                -- کلیدِ تطبیق؛ یکتا وقتی خالی نیست (ایندکسِ پارشیالِ زیر)
    birthday TEXT,                              -- 'YYYY-MM-DD' میلادی (فرانت شمسی نمایش می‌ده)
    address TEXT,
    referral_source TEXT,                       -- نحوه‌ی آشنایی (اینستاگرام/معرفیِ دوستان/گوگل/تابلو/سایر)
    allergies_notes TEXT,                       -- حساسیت/آلرژی
    medical_notes TEXT,                         -- یادداشتِ پزشکی/موانع (بارداری، داروی رقیق‌کننده‌ی خون، و…)
    photo_consent TEXT NOT NULL DEFAULT 'not_asked', -- 'yes' | 'no' | 'not_asked'
    notes TEXT,                                 -- یادداشتِ عمومیِ آزاد
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;

  -- نوبت‌ها (دفترچه‌ی رزرو دستیِ پذیرش — رزروِ واقعی هنوز از طریقِ پیامک میاد، پذیرش همینجا ثبتش می‌کنه)
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL, -- لینکِ خودکار به پروفایلِ CRM (اگه تلفن داده بشه)
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

  -- کدهای یک‌بارمصرفِ ورودِ مشتری (پورتالِ مشتری) — به‌ازایِ هر تلفن فقط یه کدِ فعال
  CREATE TABLE IF NOT EXISTS customer_otps (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  -- سشنِ ورودِ پورتالِ مشتری — جدا از سشنِ پنلِ ادمین/پرسنل
  CREATE TABLE IF NOT EXISTS customer_sessions (
    token TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  -- ===== ERP فازِ ۱: انبار، پرونده‌ی درمان، پرداخت =====

  -- محصولاتِ انبار (بوتاکس، فیلر، مواد مصرفی…). unit همون واحدیه که هم خرید هم مصرف باهاش ثبت می‌شه
  -- (مثلاً بوتاکس «واحد»: خریدِ یه ویالِ ۱۰۰ واحدی = ۱۰۰). حذف نمی‌شن، فقط غیرفعال.
  CREATE TABLE IF NOT EXISTS inventory_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT,
    category TEXT NOT NULL DEFAULT 'other',    -- 'toxin' | 'filler' | 'skinbooster' | 'consumable' | 'other'
    unit TEXT NOT NULL DEFAULT 'عدد',
    low_stock_threshold REAL,                  -- NULL = هشدارِ کم‌شدن نده
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- هر خرید = یه سری (lot) با شماره‌ی سری و انقضایِ خودش؛ مصرف از سری‌ها کم می‌شه
  CREATE TABLE IF NOT EXISTS inventory_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
    lot_number TEXT,
    expiry_date TEXT,                          -- 'YYYY-MM-DD' میلادی
    quantity_received REAL NOT NULL,
    quantity_remaining REAL NOT NULL,
    unit_cost INTEGER,                         -- تومان به‌ازایِ هر واحد (اختیاری)
    supplier TEXT,
    received_at TEXT NOT NULL,                 -- 'YYYY-MM-DD'
    note TEXT,
    created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lots_product ON inventory_lots(product_id);

  -- دفترِ همه‌ی ورود/خروج‌هایِ انبار (مثبت = ورود، منفی = خروج)
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES inventory_lots(id) ON DELETE SET NULL,
    change REAL NOT NULL,
    reason TEXT NOT NULL,                      -- 'purchase' | 'treatment' | 'treatment_undo' | 'adjust' | 'waste'
    treatment_item_id INTEGER,
    note TEXT,
    created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id);

  -- پرونده‌ی درمانِ هر نوبت: هر ردیف یه محصولِ مصرف‌شده (یا یه کارِ بدونِ محصول، مثلِ RF).
  -- اسمِ محصول/شماره‌ی سری/انقضا snapshot می‌شن تا پرونده‌ی پزشکی با تغییرِ انبار عوض نشه.
  CREATE TABLE IF NOT EXISTS treatment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES inventory_products(id) ON DELETE SET NULL,
    product_name TEXT,
    lot_id INTEGER REFERENCES inventory_lots(id) ON DELETE SET NULL,
    lot_number TEXT,
    expiry_date TEXT,
    quantity REAL,
    unit TEXT,
    deducted INTEGER NOT NULL DEFAULT 0,       -- ۱ = از انبار کم شده
    area TEXT,                                 -- ناحیه (پیشانی، لب، …)
    note TEXT,
    created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_treatment_booking ON treatment_items(booking_id);
  CREATE INDEX IF NOT EXISTS idx_treatment_customer ON treatment_items(customer_id);

  -- پرداخت‌ها — با حذفِ نوبت پاک نمی‌شن (رکوردِ پول می‌مونه)
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,                   -- تومان؛ بازپرداخت منفی ذخیره می‌شه
    method TEXT NOT NULL,                      -- 'cash' | 'card' | 'transfer'
    kind TEXT NOT NULL DEFAULT 'payment',      -- 'payment' | 'deposit' | 'refund'
    paid_at TEXT NOT NULL,                     -- 'YYYY-MM-DD'
    note TEXT,
    created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
  CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_at);

  -- شمارشِ تلاش‌هایِ اشتباهِ ورودِ پنل، به‌ازایِ «نام‌کاربری + IP» — ۵ اشتباه = ۱۵ دقیقه قفل (src/routes/auth.js)
  CREATE TABLE IF NOT EXISTS admin_login_attempts (
    attempt_key TEXT PRIMARY KEY,              -- 'username|ip'
    failed INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- دسترسیِ مشتری به پروفایلِ آنلاین با رمز (جایگزینِ موقتِ ورودِ پیامکی) — منطقش تو src/portalAccess.js
  -- عمداً جدا از customers تا هشِ رمز هیچ‌وقت با SELECT * روت‌هایِ پنل به مرورگر نرسه. نبودنِ ردیف = غیرفعال.
  CREATE TABLE IF NOT EXISTS customer_portal_access (
    customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' (رمزِ پیش‌فرض، منتظرِ تعیینِ رمز) | 'active'
    password_hash TEXT,
    password_salt TEXT,
    activation_expires_at TEXT,                -- فقط تو pending: تا کِی رمزِ پیش‌فرض قبوله (ISO)
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,                         -- ISO؛ بعد از ۵ تلاشِ اشتباه
    activated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// مایگریشنِ دستیِ ستونِ جدید رو دیتابیس‌های قدیمی‌تر — CREATE TABLE IF NOT EXISTS ستونِ جدید به جدولِ ازقبل‌موجود اضافه نمی‌کنه
const bookingsCols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
if (!bookingsCols.includes('customer_id')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);`);

// مدت‌زمانِ نوبت لحظه‌ی ثبت (snapshot) — برای اینکه محاسبه‌ی اسلات‌های فازِ رزروِ آنلاین
// بعداً با تغییرِ duration_minutes خودِ خدمت به‌هم نریزه
if (!bookingsCols.includes('duration_minutes')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN duration_minutes INTEGER;`);
}

// مبلغِ نهاییِ هر نوبت (تومان) — NULL یعنی هنوز تعیین نشده (ERP فازِ ۱)
if (!bookingsCols.includes('price')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN price INTEGER;`);
}

const SCHEMA_VERSION = '7';
const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
if (!row) {
  db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
} else if (row.value !== SCHEMA_VERSION) {
  db.prepare('UPDATE _meta SET value = ? WHERE key = ?').run(SCHEMA_VERSION, 'schema_version');
}

// اگه هنوز هیچ پرسنلی نیست، دکتر فرناز رو به‌عنوانِ صاحب/پرسنلِ اول می‌سازیم
const staffCount = db.prepare('SELECT COUNT(*) AS c FROM staff').get().c;
if (staffCount === 0) {
  db.prepare(`INSERT INTO staff (name, role, active, sort_order) VALUES (?, 'owner', 1, 0)`).run('دکتر فرناز گنجایی');
}
