import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, uploadsDir } from './db.js';

import authRoutes from './routes/auth.js';
import staffRoutes from './routes/staff.js';
import servicesRoutes from './routes/services.js';
import publicRoutes from './routes/public.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
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
app.use('/api/public', publicRoutes);

// عکس‌های آپلودشده — استاتیک
app.use('/uploads', express.static(uploadsDir));

// خودِ پنلِ مدیریت — یه فرانتِ استاتیکِ ساده، پشتِ همین سرور
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// هندلرِ خطای عمومی (مثلاً خطاهای multer)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || 'خطای سرور' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`liana-server گوش می‌ده رو پورت ${PORT}`);
  console.log(`پنلِ مدیریت: http://localhost:${PORT}/admin/`);
});
