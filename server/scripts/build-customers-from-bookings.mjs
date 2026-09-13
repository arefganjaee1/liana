// بک‌فیلِ CRM — نوبت‌هایی که قبل از اضافه‌شدنِ فیچرِ «مشتریان» ثبت شدن، customer_id ندارن.
// این اسکریپت برایِ هر نوبتِ بدونِ customer_id که تلفن داره، یه پروفایلِ مشتری پیدا/می‌سازه و وصلش می‌کنه.
// idempotent‌ه — اجرایِ دوباره چیزی رو duplicate نمی‌کنه (چون فقط رو نوبت‌هایی کار می‌کنه که هنوز customer_id ندارن).
// طبقِ درسِ #۴۸ (فایلِ دیتابیس با git pull منتقل نمی‌شه)، این اسکریپت باید مستقیم رو هر محیط (لوکال، VPS) جدا اجرا بشه.
import { db } from '../src/db.js';
import { normalizePhone } from '../src/phone.js';

function resolveCustomerId(phoneRaw, name) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone);
  return Number(info.lastInsertRowid);
}

const rows = db.prepare('SELECT id, customer_name, customer_phone FROM bookings WHERE customer_id IS NULL AND customer_phone IS NOT NULL').all();

let linked = 0;
let createdCustomers = 0;
const before = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;

for (const b of rows) {
  const cid = resolveCustomerId(b.customer_phone, b.customer_name);
  if (cid) {
    db.prepare('UPDATE bookings SET customer_id = ? WHERE id = ?').run(cid, b.id);
    linked++;
  }
}

const after = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
createdCustomers = after - before;

console.log(`بررسی شد: ${rows.length} نوبتِ بدونِ پروفایل`);
console.log(`وصل شد: ${linked} نوبت`);
console.log(`پروفایلِ جدیدِ ساخته‌شده: ${createdCustomers}`);
console.log('تمام.');
