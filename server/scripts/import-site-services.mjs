// ایمپورتِ متنیِ خدماتِ سایت (site/index.html → آرایه‌ی SERVICES) به دیتابیسِ پنل.
// فقط عنوان/توضیح/دسته‌بندی/variantها رو می‌گیره؛ قیمت و مدت‌زمان خالی می‌مونن (باید دستی از پنل پر بشن)
// و هیچ عکس/پرسنلی ایمپورت نمی‌شه (اونا مالِ خودِ پنل‌ان، نه سایت).
// این اسکریپت idempotent-ه: اگه یه خدمت با همون slug از قبل تو دیتابیس باشه، دوباره اضافه نمی‌شه (skip).
//
// اجرا (از پوشه‌ی server/): node scripts/import-site-services.mjs [مسیرِ site/index.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteIndexPath = process.argv[2] || path.join(__dirname, '..', '..', 'site', 'index.html');

function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extractServices(html) {
  const match = html.match(/const SERVICES = (\[[\s\S]*?\n\s*\]);/);
  if (!match) throw new Error('آرایه‌ی SERVICES تو فایل پیدا نشد — فرمتِ site/index.html عوض شده؟');
  // منبع، فایلِ خودِ همین پروژه‌ست (نه ورودیِ خارجی/کاربر)، پس new Function اینجا امنه.
  return new Function('return ' + match[1])();
}

function main() {
  console.log('در حالِ خوندنِ:', siteIndexPath);
  const html = fs.readFileSync(siteIndexPath, 'utf8');
  const services = extractServices(html);
  console.log(`${services.length} خدمت تو سایت پیدا شد.`);

  let maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM services').get().m;
  const insertService = db.prepare(`
    INSERT INTO services (title, slug, description, category, price, duration_minutes, active, sort_order)
    VALUES (?, ?, ?, ?, NULL, NULL, 1, ?)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO service_variants (service_id, title, price, duration_minutes, sort_order)
    VALUES (?, ?, NULL, NULL, ?)
  `);
  const findBySlug = db.prepare('SELECT id FROM services WHERE slug = ?');

  let imported = 0;
  let skipped = 0;
  const importedTitles = [];

  services.forEach((svc) => {
    const slug = slugify(svc.title);
    const existing = findBySlug.get(slug);
    if (existing) {
      console.log(`— رد شد (از قبل موجوده): «${svc.title}»`);
      skipped++;
      return;
    }
    maxOrder += 1;
    const info = insertService.run(svc.title, slug, svc.desc || null, svc.cat || null, maxOrder);
    const serviceId = Number(info.lastInsertRowid);
    (svc.variants || []).forEach((vTitle, i) => {
      insertVariant.run(serviceId, vTitle, i);
    });
    console.log(`+ اضافه شد: «${svc.title}» (دسته: ${svc.cat || '—'}, ${svc.variants?.length || 0} variant)`);
    importedTitles.push(svc.title);
    imported++;
  });

  console.log(`\nتمام. ${imported} خدمتِ جدید اضافه شد، ${skipped} تا (از قبل موجود بودن) رد شدن.`);

  const rfBody = services.find((s) => s.key === 'rf-body');
  if (rfBody && importedTitles.includes(rfBody.title)) {
    console.log(
      `\nنکته: خدمتِ «${rfBody.title}» تو سایت دسته‌ش «skin» (پوست و لیزر) تنظیم شده، ` +
      `ولی محتواش (لاغری/کاهشِ وزن) به‌نظر بیشتر با دسته‌ی «weight-loss» (لاغری) تو پنل هم‌خونی داره. ` +
      `عمداً همون دسته‌ی سایت رو گذاشتیم تا خودتون تصمیم بگیرید — اگه خواستید از پنل عوضش کنید.`
    );
  }
}

main();
