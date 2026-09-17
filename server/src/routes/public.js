import { Router } from 'express';
import { db } from '../db.js';
import { normalizePhone } from '../phone.js';
import { resolveCustomerId } from './bookings.js';
import { computeSlotsForDate, computeAvailableDaysAhead, isSlotStillAvailable, getServiceDuration } from '../availability.js';

const router = Router();

function loadActiveService(serviceIdRaw) {
  const id = serviceIdRaw ? Number(serviceIdRaw) : null;
  if (!id) return null;
  return db.prepare('SELECT id, title, duration_minutes FROM services WHERE id = ? AND active = 1').get(id);
}

// روزهایی از n روزِ آینده که حداقل یه اسلاتِ خالی دارن — برایِ نوارِ روزهایِ تقویم
// فازِ رزروِ آنلاین — هنوز به هیچ دکمه/صفحه‌ی رو-به-مشتری وصل نیست، فقط زیرساخته (غیرفعال طبقِ خواسته‌ی صریحِ کاربر)
router.get('/availability/days', (req, res) => {
  const svc = loadActiveService(req.query.service_id);
  const duration = getServiceDuration(svc);
  const days = computeAvailableDaysAhead(duration);
  res.json({ ok: true, days, duration_minutes: duration });
});

// اسلاتِ خالیِ یه تاریخِ خاص — همون، هنوز غیرفعال/بدونِ لینکِ عمومی
router.get('/availability/slots', (req, res) => {
  const dateStr = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ ok: false, error: 'تاریخ نامعتبره' });
  const svc = loadActiveService(req.query.service_id);
  const duration = getServiceDuration(svc);
  const slots = computeSlotsForDate(dateStr, duration);
  res.json({ ok: true, slots, duration_minutes: duration });
});

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
  const svc = loadActiveService(serviceIdRaw);
  if (svc) { svcId = svc.id; svcTitle = svc.title; }

  // فازِ رزروِ آنلاین (هنوز غیرفعال/بدونِ UIِ عمومی): اگه یه اسلاتِ واقعیِ تاریخ+ساعت از قبل محاسبه‌شده فرستاده بشه،
  // به‌جایِ booking_date=امروز/booking_time=NULLِ فازِ ۱، همون تاریخ/ساعتِ انتخابی + مدت‌زمانِ اسنپ‌شات‌شده ذخیره می‌شه.
  // نوبت همچنان با status='pending' ثبت می‌شه — یعنی این یه «هولدِ نرم»ه، نه تاییدِ قطعی؛ پرسنل باید تاییدش کنه
  // (طبقِ تصمیمِ صریحِ کاربر: نیازی به انتخابِ خودکارِ پرسنل نیست، اون تخصیص دستیِ بعدیِ پرسنله).
  const bookingDateRaw = String(req.body?.booking_date || '').trim();
  const bookingTimeRaw = String(req.body?.booking_time || '').trim();
  const hasSlot = /^\d{4}-\d{2}-\d{2}$/.test(bookingDateRaw) && /^\d{2}:\d{2}$/.test(bookingTimeRaw);

  let bookingDate = new Date().toISOString().slice(0, 10);
  let bookingTime = null;
  let durationMinutes = null;
  if (hasSlot) {
    const duration = getServiceDuration(svc);
    if (!isSlotStillAvailable(bookingDateRaw, bookingTimeRaw, duration)) {
      return res.status(409).json({ ok: false, error: 'این ساعت همین الان توسطِ یه نفرِ دیگه رزرو شد — یه ساعتِ دیگه رو انتخاب کن.' });
    }
    bookingDate = bookingDateRaw;
    bookingTime = bookingTimeRaw;
    durationMinutes = duration;
  }

  const customerId = resolveCustomerId(phone, name);
  const noteBits = ['درخواست از سایت'];
  if (!hasSlot && preferredWhen) noteBits.push('ترجیحِ زمانی: ' + preferredWhen);
  if (noteRaw) noteBits.push(noteRaw);

  const info = db.prepare(`
    INSERT INTO bookings (customer_name, customer_phone, customer_id, service_id, service_title, booking_date, booking_time, duration_minutes, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(name, phone, customerId, svcId, svcTitle, bookingDate, bookingTime, durationMinutes, noteBits.join(' — '));

  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

export default router;
