import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';

const router = Router();

const STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];

function fullBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

// لیست — با فیلترِ اختیاریِ یه روزِ خاص (?date=YYYY-MM-DD) یا یه بازه (?from=&to=)؛ بدونِ فیلتر یعنی همه، جدیدترین اول
router.get('/', requireAuth(), (req, res) => {
  const { date, from, to } = req.query;
  let rows;
  if (date) {
    rows = db.prepare(`
      SELECT * FROM bookings WHERE booking_date = ?
      ORDER BY (booking_time IS NULL), booking_time, id
    `).all(date);
  } else if (from && to) {
    rows = db.prepare(`
      SELECT * FROM bookings WHERE booking_date BETWEEN ? AND ?
      ORDER BY booking_date, (booking_time IS NULL), booking_time, id
    `).all(from, to);
  } else {
    rows = db.prepare(`
      SELECT * FROM bookings
      ORDER BY booking_date DESC, (booking_time IS NULL), booking_time DESC, id DESC
    `).all();
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

  const info = db.prepare(`
    INSERT INTO bookings (customer_name, customer_phone, service_id, service_title, staff_id, staff_name, booking_date, booking_time, status, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customer_name.trim(),
    customer_phone && customer_phone.trim() ? customer_phone.trim() : null,
    svcId, svcTitle, stfId, staffName,
    booking_date,
    booking_time && booking_time.trim() ? booking_time.trim() : null,
    st,
    note && note.trim() ? note.trim() : null,
    req.user.id,
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid), booking: fullBooking(Number(info.lastInsertRowid)) });
});

router.put('/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = fullBooking(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });

  const { customer_name, customer_phone, service_id, service_title, staff_id, booking_date, booking_time, status, note } = req.body || {};

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

  db.prepare(`
    UPDATE bookings SET
      customer_name = ?, customer_phone = ?, service_id = ?, service_title = ?, staff_id = ?, staff_name = ?,
      booking_date = ?, booking_time = ?, status = ?, note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    customer_name !== undefined && customer_name.trim() ? customer_name.trim() : existing.customer_name,
    customer_phone !== undefined ? (customer_phone && customer_phone.trim() ? customer_phone.trim() : null) : existing.customer_phone,
    svcId, svcTitle, stfId, staffName,
    booking_date !== undefined ? booking_date : existing.booking_date,
    booking_time !== undefined ? (booking_time && booking_time.trim() ? booking_time.trim() : null) : existing.booking_time,
    st,
    note !== undefined ? (note && note.trim() ? note.trim() : null) : existing.note,
    id,
  );
  res.json({ ok: true, booking: fullBooking(id) });
});

// حذفِ کاملِ یه نوبت — فقط ادمین (منیجر می‌تونه به‌جاش وضعیت رو «لغوشده» کنه، همون الگویِ حذفِ خدمات/پرسنل)
router.delete('/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
