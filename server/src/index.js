import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, uploadsDir } from './db.js';

import authRoutes from './routes/auth.js';
import staffRoutes from './routes/staff.js';
import servicesRoutes from './routes/services.js';
import bookingsRoutes from './routes/bookings.js';
import customersRoutes from './routes/customers.js';
import publicRoutes from './routes/public.js';
import customerAuthRoutes from './routes/customerAuth.js';
import inventoryRoutes from './routes/inventory.js';
import sessionFileRoutes from './routes/sessionFile.js';
import backupsRoutes from './routes/backups.js';
import { startBackupSchedule } from './backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

// پشتِ nginx اجرا می‌شیم: IPِ واقعیِ بازدیدکننده رو از X-Forwarded-For بخون (برایِ قفلِ تلاش‌هایِ ورود)
app.set('trust proxy', 'loopback');

// CORS: تو production فقط دامنه‌هایِ خودمون اجازه‌ی صدازدنِ API با کوکی رو دارن.
// (سایت از beautyliana.ir فرمِ مشاوره رو می‌فرسته، کارت از card.beautyliana.ir وضعیتِ ورود رو چک می‌کنه.)
// تو توسعه‌ی لوکال همه آزادن. برایِ عوض‌کردنِ لیست بدونِ تغییرِ کد: CORS_ORIGINS تو .env (با کاما جدا).
const PROD_ORIGINS = (process.env.CORS_ORIGINS
  || 'https://beautyliana.ir,https://www.beautyliana.ir,https://card.beautyliana.ir,https://panel.beautyliana.ir')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (origin, cb) => cb(null, !origin || PROD_ORIGINS.includes(origin))
    : true,
  credentials: true,
}));

// هدرهایِ امنیتیِ پایه برایِ پنل/پورتال/API
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());

app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
  res.json({
    ok: true,
    service: 'liana-server',
    schema_version: row?.value ?? null,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin/staff', staffRoutes);
app.use('/api/admin/services', servicesRoutes);
app.use('/api/admin/bookings', bookingsRoutes);
app.use('/api/admin/bookings', sessionFileRoutes); // /:id/file، /:id/treatments، /:id/payments
app.use('/api/admin/inventory', inventoryRoutes);
app.use('/api/admin/backups', backupsRoutes);
app.use('/api/admin/customers', customersRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/customer/auth', customerAuthRoutes);

// عکس‌های آپلودشده — استاتیک
app.use('/uploads', express.static(uploadsDir));

// خودِ پنلِ مدیریت — یه فرانتِ استاتیکِ ساده، پشتِ همین سرور
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// پورتالِ مشتری (ورود با تلفن+کد، نمایشِ امتیاز/تاریخچه) — فرانتِ استاتیکِ جدا، پشتِ همین سرور
app.use('/portal', express.static(path.join(__dirname, '..', 'portal')));

// آدرسِ ریشه — فعلاً سایتِ اصلی این‌جا نیست، پس مستقیم به لاگینِ پنل هدایت کن
app.get('/', (req, res) => res.redirect('/admin/login.html'));

// هندلرِ خطای عمومی (مثلاً خطاهای multer)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || 'خطای سرور' });
});

const PORT = process.env.PORT || 3001;
startBackupSchedule();

app.listen(PORT, () => {
  console.log(`liana-server گوش می‌ده رو پورت ${PORT}`);
  console.log(`پنلِ مدیریت: http://localhost:${PORT}/admin/`);
});
