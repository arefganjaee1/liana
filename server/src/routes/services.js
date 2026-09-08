import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, uploadsDir } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10) || '.jpg';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('فقط عکس مجازه'));
    cb(null, true);
  },
});

function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function fullService(id) {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return null;
  const variants = db.prepare('SELECT * FROM service_variants WHERE service_id = ? ORDER BY sort_order, id').all(id);
  const images = db.prepare('SELECT * FROM service_images WHERE service_id = ? ORDER BY sort_order, id').all(id);
  const staff = db.prepare(`
    SELECT s.id, s.name, s.role FROM staff s
    JOIN service_staff ss ON ss.staff_id = s.id
    WHERE ss.service_id = ?
    ORDER BY s.sort_order, s.id
  `).all(id);
  return { ...svc, active: !!svc.active, variants, images, staff };
}

// ===== لیست برای پنل (همه، فعال و غیرفعال) =====
router.get('/', requireAuth(), (req, res) => {
  const rows = db.prepare('SELECT id FROM services ORDER BY sort_order, id').all();
  res.json({ ok: true, services: rows.map((r) => fullService(r.id)) });
});

router.get('/:id', requireAuth(), (req, res) => {
  const svc = fullService(Number(req.params.id));
  if (!svc) return res.status(404).json({ ok: false, error: 'خدمت پیدا نشد' });
  res.json({ ok: true, service: svc });
});

router.post('/', requireAuth(WRITE_ROLES), (req, res) => {
  const { title, description, category, price, duration_minutes } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ ok: false, error: 'عنوان لازمه' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM services').get().m;
  let slug = slugify(title);
  const slugExists = db.prepare('SELECT id FROM services WHERE slug = ?').get(slug);
  if (slugExists) slug = slug + '-' + crypto.randomBytes(3).toString('hex');
  const info = db.prepare(`
    INSERT INTO services (title, slug, description, category, price, duration_minutes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title.trim(), slug, description || null, category || null, price ?? null, duration_minutes ?? null, maxOrder + 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid), service: fullService(Number(info.lastInsertRowid)) });
});

router.put('/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'خدمت پیدا نشد' });
  const { title, description, category, price, duration_minutes, active } = req.body || {};
  db.prepare(`
    UPDATE services SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      category = COALESCE(?, category),
      price = ?,
      duration_minutes = ?,
      active = COALESCE(?, active),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title ?? null,
    description ?? null,
    category ?? null,
    price === undefined ? db.prepare('SELECT price FROM services WHERE id=?').get(id).price : price,
    duration_minutes === undefined ? db.prepare('SELECT duration_minutes FROM services WHERE id=?').get(id).duration_minutes : duration_minutes,
    active === undefined ? null : (active ? 1 : 0),
    id,
  );
  res.json({ ok: true, service: fullService(id) });
});

router.delete('/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  const images = db.prepare('SELECT filename FROM service_images WHERE service_id = ?').all(id);
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  images.forEach((img) => {
    const p = path.join(uploadsDir, img.filename);
    fs.unlink(p, () => {});
  });
  res.json({ ok: true });
});

// ===== variantها — کلِ لیست جایگزین می‌شه (ساده‌ترین راهِ همگام‌سازی از فرم) =====
router.put('/:id/variants', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'خدمت پیدا نشد' });
  const { variants } = req.body || {};
  if (!Array.isArray(variants)) return res.status(400).json({ ok: false, error: 'فرمتِ variants درست نیست' });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM service_variants WHERE service_id = ?').run(id);
    const insert = db.prepare('INSERT INTO service_variants (service_id, title, price, duration_minutes, sort_order) VALUES (?, ?, ?, ?, ?)');
    variants.forEach((v, i) => {
      if (!v.title || !v.title.trim()) return;
      insert.run(id, v.title.trim(), v.price ?? null, v.duration_minutes ?? null, i);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, service: fullService(id) });
});

// ===== پرسنلِ انجام‌دهنده — کلِ لیستِ id ها جایگزین می‌شه =====
router.put('/:id/staff', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'خدمت پیدا نشد' });
  const { staff_ids } = req.body || {};
  if (!Array.isArray(staff_ids)) return res.status(400).json({ ok: false, error: 'فرمتِ staff_ids درست نیست' });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM service_staff WHERE service_id = ?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO service_staff (service_id, staff_id) VALUES (?, ?)');
    staff_ids.forEach((sid) => insert.run(id, Number(sid)));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, service: fullService(id) });
});

// ===== عکس‌ها =====
router.post('/:id/images', requireAuth(WRITE_ROLES), upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'خدمت پیدا نشد' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'عکس ارسال نشد' });
  const type = ['sample', 'before', 'after', 'equipment'].includes(req.body.type) ? req.body.type : 'sample';
  const pairKey = req.body.pair_key || null;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM service_images WHERE service_id = ?').get(id).m;
  const info = db.prepare('INSERT INTO service_images (service_id, type, pair_key, filename, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(id, type, pairKey, req.file.filename, maxOrder + 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid), filename: req.file.filename, url: `/uploads/${req.file.filename}` });
});

router.delete('/:id/images/:imageId', requireAuth('admin'), (req, res) => {
  const imageId = Number(req.params.imageId);
  const img = db.prepare('SELECT * FROM service_images WHERE id = ? AND service_id = ?').get(imageId, Number(req.params.id));
  if (!img) return res.status(404).json({ ok: false, error: 'عکس پیدا نشد' });
  db.prepare('DELETE FROM service_images WHERE id = ?').run(imageId);
  fs.unlink(path.join(uploadsDir, img.filename), () => {});
  res.json({ ok: true });
});

export default router;
