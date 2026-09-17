import { db } from './db.js';

// --- تنظیماتِ فازِ ۲ (رزروِ آنلاینِ لحظه‌ای) ---
// این مقادیر عمداً اینجا متمرکزن تا بعداً راحت قابلِ تغییر باشن (مثلاً از رویِ تنظیماتِ ادمین)
export const SLOT_STEP_MINUTES = 30; // اندازه‌ی هر گامِ زمانیِ قابل‌انتخاب رو تقویم
export const DEFAULT_DURATION_MINUTES = 45; // فقط برایِ خدماتی که هنوز duration_minutes نداره (دیتایِ موقت، منتظرِ جلسه‌یِ دکتر فرناز)
export const BOOKABLE_DAYS_AHEAD = 14; // چند روزِ آینده رو تقویمِ رزرو نشون داده می‌شه

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function getServiceDuration(service) {
  return (service && service.duration_minutes) || DEFAULT_DURATION_MINUTES;
}

// ساعاتِ کاریِ واقعیِ همه‌یِ پرسنل رو یه تاریخِ خاص: پنجره‌هایِ [start,end] به‌دقیقه، بعدِ کسرِ استثناهایِ اون روز
function workingWindowsForDate(dateStr) {
  const weekday = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=یکشنبه ... 6=شنبه — هم‌راستا با ستونِ weekday تو staff_hours
  const rows = db.prepare(`
    SELECT staff_id, start_time, end_time FROM staff_hours
    WHERE weekday = ? AND is_off = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL
  `).all(weekday);

  const exceptionStaffIds = new Set(
    db.prepare(`SELECT staff_id FROM staff_exceptions WHERE date = ?`).all(dateStr).map((r) => r.staff_id)
  );

  return rows
    .filter((r) => !exceptionStaffIds.has(r.staff_id))
    .map((r) => ({ staffId: r.staff_id, start: timeToMinutes(r.start_time), end: timeToMinutes(r.end_time) }));
}

// چندتا پرسنل هم‌زمان تو کلِ بازه‌یِ [slotStart, slotEnd) کار می‌کنن — این می‌شه ظرفیتِ هم‌زمانِ کلینیک تو اون بازه
function capacityAt(windows, slotStart, slotEnd) {
  return windows.filter((w) => w.start <= slotStart && w.end >= slotEnd).length;
}

function activeBookingsForDate(dateStr) {
  return db.prepare(`
    SELECT booking_time, duration_minutes FROM bookings
    WHERE booking_date = ? AND status IN ('pending','confirmed') AND booking_time IS NOT NULL
  `).all(dateStr).map((b) => ({
    start: timeToMinutes(b.booking_time),
    end: timeToMinutes(b.booking_time) + (b.duration_minutes || DEFAULT_DURATION_MINUTES),
  }));
}

// لیستِ اسلاتِ خالیِ یه روزِ خاص، برایِ یه خدمتِ با مدت‌زمانِ durationMinutes
// منطق: پنجره‌ی کاریِ پرسنل (منهایِ استثنا) رو تقسیم به گام‌هایِ SLOT_STEP_MINUTES می‌کنه،
// و هر گام رو نگه می‌داره فقط اگه تعدادِ نوبت‌هایِ فعالِ هم‌پوشان از تعدادِ پرسنلِ هم‌زمانِ کاری کمتر باشه
export function computeSlotsForDate(dateStr, durationMinutes) {
  const windows = workingWindowsForDate(dateStr);
  if (windows.length === 0) return [];

  const bookings = activeBookingsForDate(dateStr);
  const dayStart = Math.min(...windows.map((w) => w.start));
  const dayEnd = Math.max(...windows.map((w) => w.end));

  const now = new Date();
  const isToday = dateStr === now.toISOString().slice(0, 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let t = dayStart; t + durationMinutes <= dayEnd; t += SLOT_STEP_MINUTES) {
    if (isToday && t <= nowMinutes) continue; // اسلاتِ گذشته/همین‌الانِ امروز رو نشون نده
    const cap = capacityAt(windows, t, t + durationMinutes);
    if (cap === 0) continue;
    const overlapping = bookings.filter((b) => b.start < t + durationMinutes && b.end > t).length;
    if (overlapping < cap) slots.push(minutesToTime(t));
  }
  return slots;
}

// نقشه‌ی {تاریخ: آیا حداقل یه اسلاتِ خالی داره} برایِ n روزِ آینده — برایِ نوارِ روزهایِ تقویم
export function computeAvailableDaysAhead(durationMinutes, daysAhead = BOOKABLE_DAYS_AHEAD) {
  const today = new Date();
  const days = {};
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    days[dateStr] = computeSlotsForDate(dateStr, durationMinutes).length > 0;
  }
  return days;
}

// چک می‌کنه یه اسلاتِ مشخص (تاریخ+ساعت) هنوز واقعاً خالیه یا نه — موقعِ ثبتِ نهاییِ درخواست (جلوگیریِ از رزروِ دوبل)
export function isSlotStillAvailable(dateStr, timeStr, durationMinutes) {
  return computeSlotsForDate(dateStr, durationMinutes).includes(timeStr);
}
