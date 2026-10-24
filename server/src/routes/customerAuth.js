import { Router } from 'express';
import { db } from '../db.js';
import { normalizePhone } from '../phone.js';
import {
  requireCustomerAuth,
  createCustomerSession,
  destroyCustomerSession,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  parseCookies,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import {
  DEFAULT_PORTAL_PASSWORD,
  MAX_FAILED_ATTEMPTS,
  LOCK_MS,
  normalizeDigits,
  getPortalAccess,
} from '../portalAccess.js';

// ورودِ پورتالِ مشتری با شماره + رمز. ورودِ پیامکی (OTP) فعلاً برداشته شده چون سرویسِ پیامکِ واقعی
// وصل نیست؛ ماژولِ src/sms.js و جدولِ customer_otps دست‌نخورده موندن برایِ وقتی که وصل بشه.
// روالِ کامل تو src/portalAccess.js توضیح داده شده.

const router = Router();

const GENERIC_LOGIN_ERROR = 'شماره یا رمز درست نیست. اگه بارِ اوّلته، از پذیرشِ کلینیک بخواه حسابت رو فعال کنه.';

function customerPoints(customerId) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM bookings WHERE customer_id = ? AND status = 'done'`).get(customerId);
  return row.c;
}

function customerHistory(customerId) {
  return db.prepare(`
    SELECT id, service_title, staff_name, booking_date, booking_time, status
    FROM bookings WHERE customer_id = ?
    ORDER BY booking_date DESC, (booking_time IS NULL), booking_time DESC, id DESC
  `).all(customerId);
}

function publicCustomer(c) {
  return { id: c.id, name: c.name, phone: c.phone };
}

function minutesLeft(iso) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
}

function recordFailure(customerId, access) {
  const failed = (access.failed_attempts || 0) + 1;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
    db.prepare(`UPDATE customer_portal_access SET failed_attempts = 0, locked_until = ?, updated_at = datetime('now') WHERE customer_id = ?`)
      .run(lockedUntil, customerId);
    return lockedUntil;
  }
  db.prepare(`UPDATE customer_portal_access SET failed_attempts = ?, updated_at = datetime('now') WHERE customer_id = ?`)
    .run(failed, customerId);
  return null;
}

router.post('/login', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const password = normalizeDigits(req.body?.password).trim();
  if (!phone || !password) return res.status(400).json({ ok: false, error: 'شماره و رمز رو وارد کن.' });

  const customer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  const access = customer ? getPortalAccess(customer.id) : null;
  if (!customer || !access) return res.status(401).json({ ok: false, error: GENERIC_LOGIN_ERROR });

  if (access.locked_until && new Date(access.locked_until).getTime() > Date.now()) {
    return res.status(429).json({ ok: false, error: `به‌خاطرِ چند تلاشِ اشتباه، ورود با این شماره موقتاً قفله. حدودِ ${minutesLeft(access.locked_until)} دقیقه‌ی دیگه دوباره امتحان کن، یا از پذیرش بخواه ریستش کنه.` });
  }

  let ok = false;
  if (access.status === 'pending') {
    if (password === DEFAULT_PORTAL_PASSWORD) {
      if (new Date(access.activation_expires_at).getTime() < Date.now()) {
        return res.status(400).json({ ok: false, error: 'مهلتِ فعال‌سازیِ حسابت تموم شده. از پذیرشِ کلینیک بخواه دوباره فعالش کنه.' });
      }
      ok = true;
    }
  } else if (access.status === 'active' && access.password_hash) {
    ok = verifyPassword(password, access.password_hash, access.password_salt);
  }

  if (!ok) {
    const lockedUntil = recordFailure(customer.id, access);
    if (lockedUntil) {
      return res.status(429).json({ ok: false, error: `به‌خاطرِ چند تلاشِ اشتباه، ورود با این شماره ${minutesLeft(lockedUntil)} دقیقه قفل شد. اگه رمزت یادت رفته، از پذیرش بخواه ریستش کنه.` });
    }
    return res.status(401).json({ ok: false, error: GENERIC_LOGIN_ERROR });
  }

  db.prepare(`UPDATE customer_portal_access SET failed_attempts = 0, locked_until = NULL WHERE customer_id = ?`).run(customer.id);
  const { token, expires } = createCustomerSession(customer.id);
  setCustomerSessionCookie(res, token, expires);
  res.json({ ok: true, must_change: access.status === 'pending' });
});

// تعیینِ رمزِ شخصی — فقط بلافاصله بعد از ورود با رمزِ پیش‌فرض (وضعیتِ pending)
router.post('/set-password', requireCustomerAuth({ allowPending: true }), (req, res) => {
  if (req.portalAccess.status !== 'pending') {
    return res.status(400).json({ ok: false, error: 'رمزت قبلاً تعیین شده. برایِ عوض‌کردنش از پذیرشِ کلینیک بخواه ریستش کنه.' });
  }
  const pw = normalizeDigits(req.body?.password).trim();
  const pw2 = normalizeDigits(req.body?.password_confirm).trim();
  if (pw.length < 6) return res.status(400).json({ ok: false, error: 'رمز باید حداقل ۶ کاراکتر باشه.' });
  if (pw.length > 100) return res.status(400).json({ ok: false, error: 'رمز خیلی بلنده.' });
  if (pw === DEFAULT_PORTAL_PASSWORD) return res.status(400).json({ ok: false, error: 'رمزِ جدید نمی‌تونه همون ۱۲۳۴۵۶ باشه.' });
  if (pw !== pw2) return res.status(400).json({ ok: false, error: 'رمز و تکرارش یکی نیستن.' });

  const { hash, salt } = hashPassword(pw);
  db.prepare(`
    UPDATE customer_portal_access SET
      status = 'active', password_hash = ?, password_salt = ?, activation_expires_at = NULL,
      failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
    WHERE customer_id = ?
  `).run(hash, salt, req.customer.id);
  // هر سشنِ دیگه‌ای جز همین دستگاه بسته می‌شه
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ? AND token != ?').run(req.customer.id, req.customerSessionToken);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[CUSTOMER_SESSION_COOKIE];
  if (token) destroyCustomerSession(token);
  clearCustomerSessionCookie(res);
  res.json({ ok: true });
});

// اطلاعاتِ پروفایل. مشتریِ pending فقط اسمش رو می‌گیره + must_change، نه امتیاز/تاریخچه.
router.get('/me', requireCustomerAuth({ allowPending: true }), (req, res) => {
  if (req.portalAccess.status !== 'active') {
    return res.json({ ok: true, must_change: true, customer: publicCustomer(req.customer) });
  }
  res.json({
    ok: true,
    must_change: false,
    customer: publicCustomer(req.customer),
    points: customerPoints(req.customer.id),
    bookings: customerHistory(req.customer.id),
  });
});

export default router;
