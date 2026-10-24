// دسترسیِ مشتری به پروفایلِ آنلاین (پورتال) — جایگزینِ موقتِ ورودِ پیامکی تا وقتی سرویسِ پیامکِ واقعی وصل بشه.
//
// روال (تصمیمِ کاربر، ۱۴۰۵/۰۸/۰۱):
//   ۱. پذیرش تو پنل، رو پروفایلِ مشتری «فعال‌سازی» رو می‌زنه (معمولاً وقتی مشتری حضوراً کلینیکه).
//   ۲. از اون لحظه تا ۱۵ دقیقه، مشتری با شماره‌ش و رمزِ پیش‌فرضِ ۱۲۳۴۵۶ می‌تونه وارد بشه.
//   ۳. همون اول مجبوره رمزِ خودش رو بذاره؛ تا نذاره به هیچ اطلاعاتی دسترسی نداره.
//   ۴. رمز یادش رفت؟ پذیرش «ریستِ رمز» می‌زنه — دقیقاً همون فعال‌سازیِ دوباره‌ست.
//
// مهلتِ ۱۵ دقیقه‌ای حفاظِ اصلیه: رمزِ پیش‌فرض برایِ همه یکیه، پس نباید یه حسابِ فعال‌شده
// روزها با ۱۲۳۴۵۶ باز بمونه. بعد از ۵ تلاشِ اشتباه هم ورود برایِ اون شماره ۱۵ دقیقه قفل می‌شه.
//
// رمز و هشش عمداً تو جدولِ جدای customer_portal_access‌ـه، نه تو customers — چون روت‌هایِ پنل
// از customers با SELECT * می‌خونن و نباید هشِ رمز هیچ‌وقت به مرورگر برسه.

import { db } from './db.js';

export const DEFAULT_PORTAL_PASSWORD = '123456';
export const ACTIVATION_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;

// ارقامِ فارسی/عربی → لاتین، تا فرقی نکنه مشتری با کیبوردِ فارسی تایپ می‌کنه یا انگلیسی
export function normalizeDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const fa = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
    return String(fa > -1 ? fa : '٠١٢٣٤٥٦٧٨٩'.indexOf(ch));
  });
}

export function getPortalAccess(customerId) {
  return db.prepare('SELECT * FROM customer_portal_access WHERE customer_id = ?').get(customerId) || null;
}

// خلاصه‌ی وضعیت برایِ پنلِ ادمین — بدونِ هیچ اطلاعاتی از رمز
//   inactive: هنوز فعال نشده | pending: منتظرِ تعیینِ رمز (رمزِ پیش‌فرض معتبره)
//   expired: فعال شده ولی مهلتِ ۱۵ دقیقه گذشته | active: مشتری رمزِ خودش رو گذاشته
export function portalInfo(customerId) {
  const row = getPortalAccess(customerId);
  if (!row) return { status: 'inactive', activation_expires_at: null, locked_until: null };
  const now = Date.now();
  let status = row.status;
  if (status === 'pending' && new Date(row.activation_expires_at).getTime() < now) status = 'expired';
  const lockedUntil = row.locked_until && new Date(row.locked_until).getTime() > now ? row.locked_until : null;
  return { status, activation_expires_at: row.activation_expires_at, locked_until: lockedUntil };
}

// فعال‌سازی و ریست دقیقاً یه کارن: رمز برمی‌گرده به پیش‌فرض، ۱۵ دقیقه مهلتِ تازه،
// قفل باز می‌شه، و همه‌یِ سشن‌هایِ قبلیِ این مشتری (رو هر دستگاهی) بسته می‌شن.
export function activatePortal(customerId, adminUserId) {
  const expires = new Date(Date.now() + ACTIVATION_WINDOW_MS).toISOString();
  db.prepare(`
    INSERT INTO customer_portal_access
      (customer_id, status, password_hash, password_salt, activation_expires_at, failed_attempts, locked_until, activated_by, updated_at)
    VALUES (?, 'pending', NULL, NULL, ?, 0, NULL, ?, datetime('now'))
    ON CONFLICT(customer_id) DO UPDATE SET
      status = 'pending', password_hash = NULL, password_salt = NULL,
      activation_expires_at = excluded.activation_expires_at,
      failed_attempts = 0, locked_until = NULL,
      activated_by = excluded.activated_by, updated_at = datetime('now')
  `).run(customerId, expires, adminUserId ?? null);
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId);
}

export function disablePortal(customerId) {
  db.prepare('DELETE FROM customer_portal_access WHERE customer_id = ?').run(customerId);
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId);
}
