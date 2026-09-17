import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { normalizePhone } from '../phone.js';
import { sendOtpSms, smsProviderInfo } from '../sms.js';
import {
  requireCustomerAuth,
  createCustomerSession,
  destroyCustomerSession,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  CUSTOMER_SESSION_COOKIE,
} from '../auth.js';
import { parseCookies } from '../auth.js';

const router = Router();

const OTP_TTL_MS = 3 * 60 * 1000; // ۳ دقیقه
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // ۶۰ ثانیه بینِ دو درخواستِ پیاپی
const OTP_MAX_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function genCode() {
  return String(Math.floor(10000 + Math.random() * 90000)); // ۵ رقمی
}

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

// درخواستِ کد — فقط برایِ تلفنی که از قبل تو دیتابیسِ مشتری‌ها ثبته (مشتریِ جدید از پورتال ساخته نمی‌شه)
router.post('/request-otp', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'شماره‌ی تلفن لازمه' });

  const customer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (!customer) {
    return res.status(404).json({ ok: false, error: 'این شماره تو سیستمِ کلینیک ثبت نشده — اگه قبلاً نوبت گرفتی، با همون شماره امتحان کن؛ وگرنه اول باید یه نوبت ثبت بشه.' });
  }

  const existing = db.prepare('SELECT * FROM customer_otps WHERE phone = ?').get(phone);
  if (existing) {
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - age) / 1000);
      return res.status(429).json({ ok: false, error: `چندلحظه صبر کن — تا ${waitSec} ثانیه‌ی دیگه می‌تونی دوباره کد بگیری.` });
    }
  }

  const code = genCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO customer_otps (phone, code_hash, attempts, expires_at) VALUES (?, ?, 0, ?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, created_at = datetime('now'), expires_at = excluded.expires_at
  `).run(phone, hashCode(code), expiresAt);

  try {
    await sendOtpSms(phone, code);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'ارسالِ پیامک شکست خورد' });
  }

  const info = smsProviderInfo();
  const showDevCode = info.isMock && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_OTP === 'true');
  res.json({ ok: true, ...(showDevCode ? { dev_code: code } : {}) });
});

// تأییدِ کد و ساختِ سشن
router.post('/verify-otp', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  if (!phone || !code) return res.status(400).json({ ok: false, error: 'شماره و کد لازمه' });

  const otp = db.prepare('SELECT * FROM customer_otps WHERE phone = ?').get(phone);
  if (!otp) return res.status(400).json({ ok: false, error: 'کدی برایِ این شماره درخواست نشده — اول درخواستِ کد بده.' });
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM customer_otps WHERE phone = ?').run(phone);
    return res.status(400).json({ ok: false, error: 'کد منقضی شده — دوباره درخواست بده.' });
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM customer_otps WHERE phone = ?').run(phone);
    return res.status(400).json({ ok: false, error: 'تعدادِ تلاش‌ها بیش‌ازحد شد — دوباره درخواستِ کدِ جدید بده.' });
  }

  if (hashCode(code) !== otp.code_hash) {
    db.prepare('UPDATE customer_otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    return res.status(400).json({ ok: false, error: 'کد اشتباهه' });
  }

  db.prepare('DELETE FROM customer_otps WHERE phone = ?').run(phone);
  const customer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (!customer) return res.status(404).json({ ok: false, error: 'مشتری پیدا نشد' });

  const { token, expires } = createCustomerSession(customer.id);
  setCustomerSessionCookie(res, token, expires);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[CUSTOMER_SESSION_COOKIE];
  if (token) destroyCustomerSession(token);
  clearCustomerSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireCustomerAuth(), (req, res) => {
  res.json({
    ok: true,
    customer: publicCustomer(req.customer),
    points: customerPoints(req.customer.id),
    bookings: customerHistory(req.customer.id),
  });
});

export default router;
