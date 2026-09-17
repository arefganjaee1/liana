import { Router } from 'express';
import { db } from '../db.js';
import { normalizePhone } from '../phone.js';
import { resolveCustomerId } from './bookings.js';

const router = Router();

// فقط خدماتِ فعال، برای مصرفِ آینده‌ی سایتِ عمومی (فازِ بعدی) — فعلاً فقط برای تست/آماده‌سازی
router.get('/services', (req, res) => {
  const rows = db.prepare('SELECT id FROM services WHERE active = 1 ORDER BY sort_order, id').all();
  const services = rows.map((r) => {
    const svc = db.prepare('SELECT id, title, slug, description, category, price, duration_minutes FROM services WHERE id = ?').get(r.id);
    const variants = db.prepare('SELECT title, price, duration_minutes FROM service_variants WHERE service_id = ? ORDER BY sort_order, id').all(r.id);
    const images = db.prepare('SELECT type, pair_key, filename FROM service_images WHERE service_id = ? ORDER BY sort_order, id').all(r.id)
      .map((img) => ({ ...img, url: `/uploads/${img.filename}` }));
    return { ...svc, variants, images };
  });
  res.json({ ok: true, services });
});

// درخواستِ نوبت از سایتِ عمومی — بدونِ نیاز به لاگین، مستقیم یه رکوردِ «در انتظارِ تایید» تو جدولِ نوبت‌ها می‌سازه
// (همون جدولی که پنلِ ادمین می‌بینه) تا پرسنل باهاش تماس بگیره و تاریخ/ساعتِ دقیق رو نهایی کنه.
// عمداً بدونِ انتخابِ تاریخ/ساعتِ دقیق نگه داشته شده — این فقط یه «درخواست»ه، نه رزروِ آنلاینِ لحظه‌ای
// (اون یه فازِ جداگونه‌ست، با محاسبه‌ی واقعیِ ساعاتِ خالی از رویِ staff_hours + duration_minutes).
router.post('/booking-request', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const phone = normalizePhone(req.body?.phone);
  const preferredWhen = String(req.body?.preferred_when || '').trim();
  const noteRaw = String(req.body?.note || '').trim();

  if (!name) return res.status(400).json({ ok: false, error: 'اسمت رو وارد کن' });
  if (!phone) return res.status(400).json({ ok: false, error: 'شماره‌ی تلفن معتبر وارد کن' });
  if (name.length > 100) return res.status(400).json({ ok: false, error: 'اسمِ واردشده خیلی بلنده' });
  if (noteRaw.length > 500) return res.status(400).json({ ok: false, error: 'توضیحات خیلی بلنده' });

  // ضدِ اسپم/دابل‌تپ‌ِ ساده: از یه شماره، تا ۲ دقیقه بعدِ آخرین درخواستِ در‌انتظار، درخواستِ جدید قبول نمی‌شه
  const recent = db.prepare(`
    SELECT id FROM bookings
    WHERE customer_phone = ? AND status = 'pending' AND created_at >= datetime('now', '-2 minutes')
  `).get(phone);
  if (recent) {
    return res.status(429).json({ ok: false, error: 'درخواستت همین الان ثبت شده — منتظرِ تماسِ ما باش.' });
  }

  let svcId = null;
  let svcTitle = 'هنوز مشخص نشده';
  const serviceIdRaw = req.body?.service_id ? Number(req.body.service_id) : null;
  if (serviceIdRaw) {
    const svc = db.prepare('SELECT id, title FROM services WHERE id = ? AND active = 1').get(serviceIdRaw);
    if (svc) { svcId = svc.id; svcTitle = svc.title; }
  }

  const customerId = resolveCustomerId(phone, name);
  const today = new Date().toISOString().slice(0, 10);
  const noteBits = ['درخواست از سایت'];
  if (preferredWhen) noteBits.push('ترجیحِ زمانی: ' + preferredWhen);
  if (noteRaw) noteBits.push(noteRaw);

  const info = db.prepare(`
    INSERT INTO bookings (customer_name, customer_phone, customer_id, service_id, service_title, booking_date, booking_time, status, note)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)
  `).run(name, phone, customerId, svcId, svcTitle, today, noteBits.join(' — '));

  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

export default router;
