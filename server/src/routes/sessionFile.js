// پرونده‌ی هر نوبت: درمانِ انجام‌شده (و کسرِ خودکار از انبار) + پرداخت‌ها و مانده.
// زیرِ همون مسیرِ /api/admin/bookings سوار می‌شه: /:id/file ، /:id/treatments ، /:id/payments

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';
import {
  productSummaries, usableLots, parseNumber, round3, recordMovement,
  returnTreatmentStock, inTransaction, tehranToday,
} from '../inventory.js';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['cash', 'card', 'transfer'];
const KINDS = ['payment', 'deposit', 'refund'];

function cleanText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

function getBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

export function bookingFinance(booking) {
  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE booking_id = ?').get(booking.id).s;
  const price = booking.price;
  return { price, paid, balance: price === null || price === undefined ? null : price - paid };
}

function fileData(booking) {
  const treatments = db.prepare('SELECT * FROM treatment_items WHERE booking_id = ? ORDER BY id').all(booking.id);
  const payments = db.prepare(`
    SELECT p.*, u.display_name AS by_name FROM payments p
    LEFT JOIN admin_users u ON u.id = p.created_by
    WHERE p.booking_id = ? ORDER BY p.paid_at, p.id
  `).all(booking.id);
  const products = productSummaries().map((p) => ({
    id: p.id, name: p.name, brand: p.brand, unit: p.unit, category: p.category, stock: p.stock,
    lots: usableLots(p.id).map((l) => ({ id: l.id, lot_number: l.lot_number, expiry_date: l.expiry_date, quantity_remaining: l.quantity_remaining })),
  }));
  return { booking, treatments, payments, finance: bookingFinance(booking), products };
}

router.get('/:id/file', requireAuth(), (req, res) => {
  const booking = getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  res.json({ ok: true, ...fileData(booking) });
});

// افزودنِ یه ردیف به پرونده‌ی درمان.
// با محصول: مقدار لازمه؛ به‌طورِ پیش‌فرض از انبار کم می‌شه (سریِ انتخابی، یا زودانقضاترین سری‌ای که کافی باشه).
// اگه موجودیِ کافی ثبت نشده باشه، 409 با code=insufficient_stock برمی‌گرده؛ فرانت می‌تونه با deduct=false دوباره بفرسته
// (چون درمان انجام شده و باید ثبت بشه، حتی اگه انبار هنوز درست وارد نشده).
// بدونِ محصول (مثلِ جلسه‌ی RF): فقط عنوان لازمه.
router.post('/:id/treatments', requireAuth(WRITE_ROLES), (req, res) => {
  const booking = getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  const b = req.body || {};
  const area = cleanText(b.area);
  const note = cleanText(b.note);
  const deduct = b.deduct !== false;

  if (!b.product_id) {
    const title = cleanText(b.product_name);
    if (!title) return res.status(400).json({ ok: false, error: 'یا یه محصول انتخاب کن یا عنوانِ کارِ انجام‌شده رو بنویس' });
    const qty = b.quantity === undefined || b.quantity === '' || b.quantity === null ? null : parseNumber(b.quantity);
    const info = db.prepare(`
      INSERT INTO treatment_items (booking_id, customer_id, product_name, quantity, unit, deducted, area, note, created_by)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(booking.id, booking.customer_id, title, qty, cleanText(b.unit), area, note, req.user.id);
    return res.json({ ok: true, id: Number(info.lastInsertRowid), ...fileData(getBooking(booking.id)) });
  }

  const product = db.prepare('SELECT * FROM inventory_products WHERE id = ?').get(Number(b.product_id));
  if (!product) return res.status(400).json({ ok: false, error: 'محصول پیدا نشد' });
  const qty = parseNumber(b.quantity);
  if (qty === null || qty <= 0) return res.status(400).json({ ok: false, error: `مقدارِ مصرف‌شده رو بنویس (به ${product.unit})` });
  const productName = product.brand ? `${product.name} (${product.brand})` : product.name;

  let lot = null;
  if (b.lot_id) {
    lot = db.prepare('SELECT * FROM inventory_lots WHERE id = ? AND product_id = ?').get(Number(b.lot_id), product.id);
    if (!lot) return res.status(400).json({ ok: false, error: 'این سری مالِ این محصول نیست' });
    if (lot.expiry_date && lot.expiry_date < tehranToday()) return res.status(400).json({ ok: false, error: 'تاریخِ این سری گذشته' });
  }

  if (deduct) {
    if (!lot) lot = usableLots(product.id).find((l) => l.quantity_remaining >= qty) || null;
    if (!lot || lot.quantity_remaining < qty) {
      const stock = productSummaries().find((p) => p.id === product.id)?.stock ?? 0;
      return res.status(409).json({
        ok: false, code: 'insufficient_stock',
        error: lot
          ? `از این سری فقط ${lot.quantity_remaining} ${product.unit} مونده.`
          : `تو انبار سری‌ای از این محصول با ${qty} ${product.unit} موجودی ثبت نشده (کلِ موجودی: ${stock} ${product.unit}).`,
      });
    }
  }

  const itemId = inTransaction(() => {
    const info = db.prepare(`
      INSERT INTO treatment_items (booking_id, customer_id, product_id, product_name, lot_id, lot_number, expiry_date, quantity, unit, deducted, area, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(booking.id, booking.customer_id, product.id, productName, lot?.id ?? null, lot?.lot_number ?? null, lot?.expiry_date ?? null,
      round3(qty), product.unit, deduct ? 1 : 0, area, note, req.user.id);
    const newId = Number(info.lastInsertRowid);
    if (deduct) {
      db.prepare('UPDATE inventory_lots SET quantity_remaining = ROUND(quantity_remaining - ?, 3) WHERE id = ?').run(qty, lot.id);
      recordMovement({ product_id: product.id, lot_id: lot.id, change: -qty, reason: 'treatment', treatment_item_id: newId, created_by: req.user.id });
    }
    return newId;
  });
  res.json({ ok: true, id: itemId, ...fileData(getBooking(booking.id)) });
});

router.delete('/:id/treatments/:itemId', requireAuth(WRITE_ROLES), (req, res) => {
  const booking = getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  const item = db.prepare('SELECT * FROM treatment_items WHERE id = ? AND booking_id = ?').get(Number(req.params.itemId), booking.id);
  if (!item) return res.status(404).json({ ok: false, error: 'ردیف پیدا نشد' });
  inTransaction(() => {
    returnTreatmentStock(item, req.user.id);
    db.prepare('DELETE FROM treatment_items WHERE id = ?').run(item.id);
  });
  res.json({ ok: true, ...fileData(getBooking(booking.id)) });
});

router.post('/:id/payments', requireAuth(WRITE_ROLES), (req, res) => {
  const booking = getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  const b = req.body || {};
  let amount = parseNumber(b.amount);
  if (amount === null || amount <= 0) return res.status(400).json({ ok: false, error: 'مبلغ باید یه عددِ مثبت باشه (تومان)' });
  amount = Math.round(amount);
  const method = METHODS.includes(b.method) ? b.method : null;
  if (!method) return res.status(400).json({ ok: false, error: 'روشِ پرداخت رو انتخاب کن' });
  const kind = KINDS.includes(b.kind) ? b.kind : 'payment';
  const paidAt = cleanText(b.paid_at) || tehranToday();
  if (!DATE_RE.test(paidAt)) return res.status(400).json({ ok: false, error: 'تاریخِ پرداخت درست نیست' });
  const info = db.prepare(`
    INSERT INTO payments (booking_id, customer_id, amount, method, kind, paid_at, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(booking.id, booking.customer_id, kind === 'refund' ? -amount : amount, method, kind, paidAt, cleanText(b.note), req.user.id);
  res.json({ ok: true, id: Number(info.lastInsertRowid), ...fileData(getBooking(booking.id)) });
});

// حذفِ رکوردِ پول فقط با ادمین
router.delete('/:id/payments/:pid', requireAuth('admin'), (req, res) => {
  const booking = getBooking(Number(req.params.id));
  if (!booking) return res.status(404).json({ ok: false, error: 'نوبت پیدا نشد' });
  const r = db.prepare('DELETE FROM payments WHERE id = ? AND booking_id = ?').run(Number(req.params.pid), booking.id);
  if (!r.changes) return res.status(404).json({ ok: false, error: 'پرداخت پیدا نشد' });
  res.json({ ok: true, ...fileData(getBooking(booking.id)) });
});

export default router;
