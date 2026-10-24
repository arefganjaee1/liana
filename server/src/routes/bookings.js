import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';
import { normalizePhone } from '../phone.js';
import { parseNumber, returnTreatmentStock, inTransaction } from '../inventory.js';

const router = Router();

const STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];

// ستون‌هایِ لیست + جمعِ پرداختی و تعدادِ ردیف‌هایِ پرونده‌ی درمان (برایِ پیلِ «مانده/تسویه» تو جدولِ نوبت‌ها)
const LIST_SELECT = `
  SELECT bookings.*,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = bookings.id) AS paid_total,
    (SELECT COUNT(*) FROM treatment_items t WHERE t.booking_id = bookings.id) AS treatment_count
  FROM bookings`;

// مبلغ: undefined = دست نزن، '' یا null = پاک کن، بقیه = عددِ صحیحِ تومان (ارقامِ فارسی و جداکننده قبوله)
function parsePrice(v) {
  if (v === undefined) return { skip: true };
  if (v === null || v === '') return { value: null };
  const n = parseNumber(v);
  if (n === null || n < 0) return { error: 'مبلغِ نوبت باید یه عدد باشه (تومان)' };
  return { value: Math.round(n) };
}

function fullBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

// اگه نوبت شماره‌تلفن داره، خودکار به یه پروفایلِ CRM وصلش کن — اگه مشتری با این تلفن از قبل هست همونو برگردون،
// وگرنه یه پروفایلِ جدید (فقط با اسم/تلفن) بساز. بدونِ تلفن، نوبت به هیچ پروفایلی وصل نمی‌شه (ناشناس می‌مونه).
export function resolveCustomerId(phoneRaw, name) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone);
  return Number(info.lastInsertRowid);
}

// لیست — با فیلترِ اختیاریِ یه روزِ خاص (?date=YYYY-MM-DD) یا یه بازه (?from=&to=)؛ بدونِ فیلتر یعنی همه، جدیدترین اول
// فیلترِ اختیاریِ ?status= (pending/confirmed/done/cancelled) — برای صفحه‌ی «مشاوره» (درخواست‌هایِ در‌انتظار)،
// قابلِ‌ترکیب با فیلترهایِ بالا؛ بدونِ این پارامتر رفتارِ قبلی دست‌نخورده می‌مونه.
router.get('/', requireAuth(), (req, res) => {
  const { date, from, to, status } = req.query;
  const st = STATUSES.includes(status) ? status : null;
  let rows;
  if (date) {
    rows = db.prepare(`
      ${LIST_SELECT} WHERE booking_date = ? ${st ? 'AND status = ?' : ''}
      ORDER BY (booking_time IS NULL), booking_time, id
    `).all(...(st ? [date, st] : [date]));
  } else if (from && to) {
    rows = db.prepare(`
      ${LIST_SELECT} WHERE booking_date BETWEEN ? AND ? ${st ? 'AND status = ?' : ''}
      ORDER BY booking_date, (booking_time IS NULL), booking_time, id
    `).all(...(st ? [from, to, st] : [from, to]));
  } else {
    rows = db.prepare(`
      ${LIST_SELECT}
      ${st ? 'WHERE status = ?' : ''}
      ORDER BY booking_date DESC, (booking_time IS NULL), booking_time DESC, id DESC
    `).all(...(st ? [st] : []));
  }
  res.json({ ok: true, bookings: rows });
});

router.get('/:id', requireAuth(), (req, res) => {
  const b = fullBooking(Number(req.params.id));
  if (!b) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  res.json({ ok: true, booking: b });
});

router.post('/', requireAuth(WRITE_ROLES), (req, res) => {
  const { customer_name, customer_phone, service_id, service_title, staff_id, booking_date, booking_time, status, note } = req.body || {};
  const priceIn = parsePrice(req.body?.price);
  if (priceIn.error) return res.status(400).json({ ok: false, error: priceIn.error });

  if (!customer_name || !customer_name.trim()) return res.status(400).json({ ok: false, error: 'نامِ مشتری لازمه' });
  if (!booking_date || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) return res.status(400).json({ ok: false, error: 'تاریخِ نوبت درست نیست' });

  let svcId = service_id ? Number(service_id) : null;
  let svcTitle = (service_title || '').trim();
  if (svcId) {
    const svc = db.prepare('SELECT title FROM services WHERE id = ?').get(svcId);
    if (!svc) return res.status(400).json({ ok: false, error: 'خدمتِ انتخاب‌شده پیدا نشد' });
    svcTitle = svc.title;
  }
  if (!svcTitle) return res.status(400).json({ ok: false, error: 'عنوانِ خدمت لازمه' });

  let stfId = staff_id ? Number(staff_id) : null;
  let staffName = null;
  if (stfId) {
    const stf = db.prepare('SELECT name FROM staff WHERE id = ?').get(stfId);
    if (!stf) return res.status(400).json({ ok: false, error: 'پرسنلِ انتخاب‌شده پیدا نشد' });
    staffName = stf.name;
  }

  const st = STATUSES.includes(status) ? status : 'confirmed';
  const finalName = customer_name.trim();
  const finalPhone = customer_phone && customer_phone.trim() ? customer_phone.trim() : null;
  const customerId = resolveCustomerId(finalPhone, finalName);

  const info = db.prepare(`
    INSERT INTO bookings (customer_name, customer_phone, customer_id, service_id, service_title, staff_id, staff_name, booking_date, booking_time, status, note, created_by, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    finalName,
    finalPhone,
    customerId,
    svcId, svcTitle, stfId, staffName,
    booking_date,
    booking_time && booking_time.trim() ? booking_time.trim() : null,
    st,
    note && note.trim() ? note.trim() : null,
    req.user.id,
    priceIn.skip ? null : priceIn.value,
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid), booking: fullBooking(Number(info.lastInsertRowid)) });
});

router.put('/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = fullBooking(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });

  const { customer_name, customer_phone, service_id, service_title, staff_id, booking_date, booking_time, status, note } = req.body || {};
  const priceIn = parsePrice(req.body?.price);
  if (priceIn.error) return res.status(400).json({ ok: false, error: priceIn.error });

  if (booking_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
    return res.status(400).json({ ok: false, error: 'تاریخِ نوبت درست نیست' });
  }

  // خدمت: اگه service_id بیاد ازش عنوانِ زنده رو می‌گیریم؛ اگه صراحتاً null بیاد یعنی «سایر» با عنوانِ آزاد
  let svcId = existing.service_id;
  let svcTitle = existing.service_title;
  if (service_id !== undefined) {
    svcId = service_id ? Number(service_id) : null;
    if (svcId) {
      const svc = db.prepare('SELECT title FROM services WHERE id = ?').get(svcId);
      if (!svc) return res.status(400).json({ ok: false, error: 'خدمتِ انتخاب‌شده پیدا نشد' });
      svcTitle = svc.title;
    } else if (service_title !== undefined) {
      svcTitle = (service_title || '').trim();
    }
  } else if (service_title !== undefined && !svcId) {
    svcTitle = (service_title || '').trim();
  }
  if (!svcTitle) return res.status(400).json({ ok: false, error: 'عنوانِ خدمت لازمه' });

  let stfId = existing.staff_id;
  let staffName = existing.staff_name;
  if (staff_id !== undefined) {
    stfId = staff_id ? Number(staff_id) : null;
    if (stfId) {
      const stf = db.prepare('SELECT name FROM staff WHERE id = ?').get(stfId);
      if (!stf) return res.status(400).json({ ok: false, error: 'پرسنلِ انتخاب‌شده پیدا نشد' });
      staffName = stf.name;
    } else {
      staffName = null;
    }
  }

  const st = status !== undefined && STATUSES.includes(status) ? status : existing.status;

  const finalName = customer_name !== undefined && customer_name.trim() ? customer_name.trim() : existing.customer_name;
  const finalPhone = customer_phone !== undefined
    ? (customer_phone && customer_phone.trim() ? customer_phone.trim() : null)
    : existing.customer_phone;
  const customerId = resolveCustomerId(finalPhone, finalName);

  db.prepare(`
    UPDATE bookings SET
      customer_name = ?, customer_phone = ?, customer_id = ?, service_id = ?, service_title = ?, staff_id = ?, staff_name = ?,
      booking_date = ?, booking_time = ?, status = ?, note = ?, price = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    finalName,
    finalPhone,
    customerId,
    svcId, svcTitle, stfId, staffName,
    booking_date !== undefined ? booking_date : existing.booking_date,
    booking_time !== undefined ? (booking_time && booking_time.trim() ? booking_time.trim() : null) : existing.booking_time,
    st,
    note !== undefined ? (note && note.trim() ? note.trim() : null) : existing.note,
    priceIn.skip ? existing.price : priceIn.value,
    id,
  );
  res.json({ ok: true, booking: fullBooking(id) });
});

// حذفِ کاملِ یه نوبت — فقط ادمین (منیجر می‌تونه به‌جاش وضعیت رو «لغوشده» کنه، همون الگویِ حذفِ خدمات/پرسنل)
router.delete('/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  // موادی که تو پرونده‌ی این نوبت از انبار کم شده بودن، برمی‌گردن. پرداخت‌ها پاک نمی‌شن (فقط از نوبت جدا می‌شن).
  inTransaction(() => {
    db.prepare('SELECT * FROM treatment_items WHERE booking_id = ?').all(id).forEach((item) => returnTreatmentStock(item, req.user.id));
    db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  });
  res.json({ ok: true });
});

export default router;
