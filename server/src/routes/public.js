import { Router } from 'express';
import { db } from '../db.js';

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

export default router;
