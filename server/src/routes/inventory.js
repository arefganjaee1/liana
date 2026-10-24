import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';
import {
  CATEGORIES, productSummaries, inventoryAlerts, parseNumber, round3,
  recordMovement, inTransaction, tehranToday,
} from '../inventory.js';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

// لیستِ محصولات با موجودی، نزدیک‌ترین انقضا و هشدارها (?all=1 یعنی غیرفعال‌ها هم)
router.get('/products', requireAuth(), (req, res) => {
  res.json({ ok: true, products: productSummaries({ includeInactive: req.query.all === '1' }) });
});

// تعدادِ محصولاتی که هشدار دارن — برایِ بجِ کنارِ «انبار» تو نوارِ پنل
router.get('/alerts', requireAuth(), (req, res) => {
  const items = inventoryAlerts();
  res.json({ ok: true, count: items.length, items });
});

router.get('/products/:id', requireAuth(), (req, res) => {
  const id = Number(req.params.id);
  const product = productSummaries({ includeInactive: true }).find((p) => p.id === id);
  if (!product) return res.status(404).json({ ok: false, error: 'محصول پیدا نشد' });
  const lots = db.prepare(`
    SELECT * FROM inventory_lots WHERE product_id = ?
    ORDER BY (quantity_remaining <= 0), (expiry_date IS NULL), expiry_date, id
  `).all(id);
  const movements = db.prepare(`
    SELECT m.*, l.lot_number, u.display_name AS by_name, b.customer_name, b.booking_date
    FROM inventory_movements m
    LEFT JOIN inventory_lots l ON l.id = m.lot_id
    LEFT JOIN admin_users u ON u.id = m.created_by
    LEFT JOIN treatment_items t ON t.id = m.treatment_item_id
    LEFT JOIN bookings b ON b.id = t.booking_id
    WHERE m.product_id = ?
    ORDER BY m.id DESC LIMIT 100
  `).all(id);
  res.json({ ok: true, product, lots, movements });
});

function validateProduct(b, existing) {
  const name = b.name !== undefined ? cleanText(b.name) : existing?.name;
  if (!name) return { error: 'اسمِ محصول لازمه' };
  const category = b.category !== undefined ? b.category : (existing?.category || 'other');
  if (!CATEGORIES.includes(category)) return { error: 'دسته‌بندی نامعتبره' };
  const unit = b.unit !== undefined ? cleanText(b.unit) : (existing?.unit || 'عدد');
  if (!unit) return { error: 'واحدِ محصول لازمه (مثلاً «واحد»، «سرنگ»، «سی‌سی»)' };
  let threshold = existing ? existing.low_stock_threshold : null;
  if (b.low_stock_threshold !== undefined) {
    threshold = b.low_stock_threshold === null || b.low_stock_threshold === '' ? null : parseNumber(b.low_stock_threshold);
    if (b.low_stock_threshold !== null && b.low_stock_threshold !== '' && (threshold === null || threshold < 0)) return { error: 'حدِ هشدار باید یه عدد باشه' };
  }
  return {
    name, category, unit, threshold,
    brand: b.brand !== undefined ? cleanText(b.brand) : (existing?.brand ?? null),
    notes: b.notes !== undefined ? cleanText(b.notes) : (existing?.notes ?? null),
    active: b.active !== undefined ? (b.active ? 1 : 0) : (existing ? existing.active : 1),
  };
}

router.post('/products', requireAuth(WRITE_ROLES), (req, res) => {
  const v = validateProduct(req.body || {}, null);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const info = db.prepare(`
    INSERT INTO inventory_products (name, brand, category, unit, low_stock_threshold, active, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(v.name, v.brand, v.category, v.unit, v.threshold, v.active, v.notes);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/products/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM inventory_products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'محصول پیدا نشد' });
  const v = validateProduct(req.body || {}, existing);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  db.prepare(`
    UPDATE inventory_products SET name = ?, brand = ?, category = ?, unit = ?, low_stock_threshold = ?, active = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.name, v.brand, v.category, v.unit, v.threshold, v.active, v.notes, id);
  res.json({ ok: true });
});

// ورودِ خرید = یه سریِ جدید
router.post('/products/:id/lots', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM inventory_products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ ok: false, error: 'محصول پیدا نشد' });
  const b = req.body || {};
  const qty = parseNumber(b.quantity);
  if (qty === null || qty <= 0) return res.status(400).json({ ok: false, error: `تعداد/مقدار باید یه عددِ مثبت باشه (به ${product.unit})` });
  const expiry = cleanText(b.expiry_date);
  if (expiry && !DATE_RE.test(expiry)) return res.status(400).json({ ok: false, error: 'تاریخِ انقضا درست نیست' });
  const receivedAt = cleanText(b.received_at) || tehranToday();
  if (!DATE_RE.test(receivedAt)) return res.status(400).json({ ok: false, error: 'تاریخِ خرید درست نیست' });
  let unitCost = null;
  if (b.unit_cost !== undefined && b.unit_cost !== null && b.unit_cost !== '') {
    unitCost = parseNumber(b.unit_cost);
    if (unitCost === null || unitCost < 0) return res.status(400).json({ ok: false, error: 'قیمتِ هر واحد باید عدد باشه' });
    unitCost = Math.round(unitCost);
  }
  const lotId = inTransaction(() => {
    const info = db.prepare(`
      INSERT INTO inventory_lots (product_id, lot_number, expiry_date, quantity_received, quantity_remaining, unit_cost, supplier, received_at, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanText(b.lot_number), expiry, round3(qty), round3(qty), unitCost, cleanText(b.supplier), receivedAt, cleanText(b.note), req.user.id);
    const newId = Number(info.lastInsertRowid);
    recordMovement({ product_id: id, lot_id: newId, change: qty, reason: 'purchase', note: cleanText(b.note), created_by: req.user.id });
    return newId;
  });
  res.json({ ok: true, lot_id: lotId });
});

// اصلاحِ موجودیِ یه سری (شمارشِ انبار، دورریز به‌خاطرِ انقضا/خرابی)
router.post('/lots/:id/adjust', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const lot = db.prepare('SELECT * FROM inventory_lots WHERE id = ?').get(id);
  if (!lot) return res.status(404).json({ ok: false, error: 'سری پیدا نشد' });
  const b = req.body || {};
  const change = parseNumber(b.change);
  if (change === null || change === 0) return res.status(400).json({ ok: false, error: 'مقدارِ تغییر باید یه عددِ غیرِصفر باشه (منفی برایِ کم‌کردن)' });
  const reason = b.reason === 'waste' ? 'waste' : 'adjust';
  if (reason === 'waste' && change > 0) return res.status(400).json({ ok: false, error: 'دورریز باید منفی باشه' });
  const next = round3(lot.quantity_remaining + change);
  if (next < 0) return res.status(400).json({ ok: false, error: `این سری فقط ${lot.quantity_remaining} مونده؛ نمی‌شه بیشتر از این کم کرد` });
  inTransaction(() => {
    db.prepare('UPDATE inventory_lots SET quantity_remaining = ? WHERE id = ?').run(next, id);
    recordMovement({ product_id: lot.product_id, lot_id: id, change, reason, note: cleanText(b.note), created_by: req.user.id });
  });
  res.json({ ok: true, quantity_remaining: next });
});

export default router;
