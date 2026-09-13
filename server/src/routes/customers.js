import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';
import { normalizePhone } from '../phone.js';

const router = Router();

const CONSENT_VALUES = ['yes', 'no', 'not_asked'];

function fullCustomer(id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) return null;
  const bookings = db.prepare(`
    SELECT id, service_title, staff_name, booking_date, booking_time, status
    FROM bookings WHERE customer_id = ?
    ORDER BY booking_date DESC, (booking_time IS NULL), booking_time DESC, id DESC
  `).all(id);
  return { ...c, bookings };
}

function cleanText(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// چک‌کردنِ یکتاییِ تلفن — اگه تلفن قبلاً برایِ مشتریِ دیگه‌ای ثبت شده، پیامِ روشن برمی‌گردونه
function findConflictingCustomer(phone, excludeId) {
  if (!phone) return null;
  const row = db.prepare('SELECT id, name FROM customers WHERE phone = ?').get(phone);
  if (row && row.id !== excludeId) return row;
  return null;
}

// لیست — با جست‌وجویِ اختیاریِ نام/تلفن (?q=)، به‌همراهِ تعدادِ نوبت و آخرین‌مراجعه‌ی هر مشتری
router.get('/', requireAuth(), (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const qNorm = normalizePhone(q) || q;
    const like = `%${q}%`;
    const likePhone = `%${qNorm}%`;
    rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS visit_count,
        (SELECT MAX(booking_date) FROM bookings b WHERE b.customer_id = c.id) AS last_visit_date
      FROM customers c
      WHERE c.name LIKE ? OR c.phone LIKE ?
      ORDER BY c.name COLLATE NOCASE
    `).all(like, likePhone);
  } else {
    rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS visit_count,
        (SELECT MAX(booking_date) FROM bookings b WHERE b.customer_id = c.id) AS last_visit_date
      FROM customers c
      ORDER BY c.name COLLATE NOCASE
    `).all();
  }
  res.json({ ok: true, customers: rows });
});

router.get('/:id', requireAuth(), (req, res) => {
  const c = fullCustomer(Number(req.params.id));
  if (!c) return res.status(404).json({ ok: false, error: 'مشتری پیدا نشد' });
  res.json({ ok: true, customer: c });
});

router.post('/', requireAuth(WRITE_ROLES), (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name);
  if (!name) return res.status(400).json({ ok: false, error: 'نامِ مشتری لازمه' });

  const phone = normalizePhone(b.phone);
  const conflict = findConflictingCustomer(phone, null);
  if (conflict) {
    return res.status(400).json({ ok: false, error: `این شماره قبلاً برایِ «${conflict.name}» ثبت شده` });
  }

  if (b.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(b.birthday)) {
    return res.status(400).json({ ok: false, error: 'فرمتِ تاریخِ تولد درست نیست' });
  }
  const consent = CONSENT_VALUES.includes(b.photo_consent) ? b.photo_consent : 'not_asked';

  const info = db.prepare(`
    INSERT INTO customers (name, phone, birthday, address, referral_source, allergies_notes, medical_notes, photo_consent, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, phone, b.birthday || null,
    cleanText(b.address) ?? null, cleanText(b.referral_source) ?? null,
    cleanText(b.allergies_notes) ?? null, cleanText(b.medical_notes) ?? null,
    consent, cleanText(b.notes) ?? null,
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid), customer: fullCustomer(Number(info.lastInsertRowid)) });
});

router.put('/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'مشتری پیدا نشد' });

  const b = req.body || {};
  const name = b.name !== undefined ? cleanText(b.name) : existing.name;
  if (!name) return res.status(400).json({ ok: false, error: 'نامِ مشتری لازمه' });

  let phone = existing.phone;
  if (b.phone !== undefined) {
    phone = normalizePhone(b.phone);
    const conflict = findConflictingCustomer(phone, id);
    if (conflict) {
      return res.status(400).json({ ok: false, error: `این شماره قبلاً برایِ «${conflict.name}» ثبت شده` });
    }
  }

  if (b.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(b.birthday)) {
    return res.status(400).json({ ok: false, error: 'فرمتِ تاریخِ تولد درست نیست' });
  }
  const consent = b.photo_consent !== undefined
    ? (CONSENT_VALUES.includes(b.photo_consent) ? b.photo_consent : existing.photo_consent)
    : existing.photo_consent;

  db.prepare(`
    UPDATE customers SET
      name = ?, phone = ?, birthday = ?, address = ?, referral_source = ?,
      allergies_notes = ?, medical_notes = ?, photo_consent = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name, phone,
    b.birthday !== undefined ? (b.birthday || null) : existing.birthday,
    b.address !== undefined ? cleanText(b.address) : existing.address,
    b.referral_source !== undefined ? cleanText(b.referral_source) : existing.referral_source,
    b.allergies_notes !== undefined ? cleanText(b.allergies_notes) : existing.allergies_notes,
    b.medical_notes !== undefined ? cleanText(b.medical_notes) : existing.medical_notes,
    consent,
    b.notes !== undefined ? cleanText(b.notes) : existing.notes,
    id,
  );
  res.json({ ok: true, customer: fullCustomer(id) });
});

// حذفِ کاملِ پروفایلِ مشتری — فقط ادمین (نوبت‌های قبلیِ این مشتری حذف نمی‌شن، فقط customer_id شون NULL می‌شه — تاریخچه دست‌نخورده می‌مونه)
router.delete('/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
