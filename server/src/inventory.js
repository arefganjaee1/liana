// منطقِ مشترکِ انبار — هم صفحه‌ی انبار ازش استفاده می‌کنه، هم پرونده‌ی درمانِ هر نوبت.
//
// موجودیِ هر محصول = جمعِ باقی‌مونده‌ی سری‌هایِ تاریخ‌نگذشته‌ش. مصرف همیشه از سری‌ای کم می‌شه که
// زودتر منقضی می‌شه (FIFO بر اساسِ انقضا)، مگه اینکه کاربر سریِ مشخصی انتخاب کرده باشه.
// هر تغییرِ موجودی یه ردیف تو inventory_movements هم می‌سازه تا تاریخچه کامل بمونه.

import { db } from './db.js';

export const CATEGORIES = ['toxin', 'filler', 'skinbooster', 'consumable', 'other'];
export const EXPIRY_WARN_DAYS = 30;

export function tehranToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ارقامِ فارسی/عربی → لاتین، جداکننده‌هایِ هزارگان حذف، «٫» → «.»
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export function productSummaries({ includeInactive = false } = {}) {
  const today = tehranToday();
  const soon = addDays(today, EXPIRY_WARN_DAYS);
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(l.quantity_remaining) FROM inventory_lots l
                WHERE l.product_id = p.id AND (l.expiry_date IS NULL OR l.expiry_date >= ?)), 0) AS stock,
      COALESCE((SELECT SUM(l.quantity_remaining) FROM inventory_lots l
                WHERE l.product_id = p.id AND l.expiry_date < ? AND l.quantity_remaining > 0), 0) AS expired_qty,
      (SELECT MIN(l.expiry_date) FROM inventory_lots l
                WHERE l.product_id = p.id AND l.quantity_remaining > 0 AND l.expiry_date >= ?) AS nearest_expiry
    FROM inventory_products p
    ${includeInactive ? '' : 'WHERE p.active = 1'}
    ORDER BY p.active DESC, p.category, p.name COLLATE NOCASE
  `).all(today, today, today);
  return rows.map((r) => {
    const stock = round3(r.stock);
    return {
      ...r,
      stock,
      expired_qty: round3(r.expired_qty),
      low: r.active === 1 && r.low_stock_threshold !== null && stock <= r.low_stock_threshold,
      expiring_soon: r.active === 1 && !!r.nearest_expiry && r.nearest_expiry <= soon,
      has_expired: r.active === 1 && r.expired_qty > 0,
    };
  });
}

export function inventoryAlerts() {
  return productSummaries().filter((p) => p.low || p.expiring_soon || p.has_expired);
}

// سری‌هایِ قابلِ‌مصرف: باقی‌مونده دارن و تاریخشون نگذشته — زودانقضاترین اول
export function usableLots(productId) {
  return db.prepare(`
    SELECT * FROM inventory_lots
    WHERE product_id = ? AND quantity_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= ?)
    ORDER BY (expiry_date IS NULL), expiry_date, received_at, id
  `).all(productId, tehranToday());
}

export function recordMovement({ product_id, lot_id = null, change, reason, treatment_item_id = null, note = null, created_by = null }) {
  db.prepare(`
    INSERT INTO inventory_movements (product_id, lot_id, change, reason, treatment_item_id, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(product_id, lot_id, round3(change), reason, treatment_item_id, note, created_by);
}

// برگردوندنِ موجودیِ یه ردیفِ پرونده‌ی درمان (وقتی ردیف یا کلِ نوبت حذف می‌شه)
export function returnTreatmentStock(item, userId) {
  if (!item || !item.deducted || !item.lot_id || !item.quantity) return;
  const lot = db.prepare('SELECT id, product_id FROM inventory_lots WHERE id = ?').get(item.lot_id);
  if (!lot) return;
  db.prepare('UPDATE inventory_lots SET quantity_remaining = ROUND(quantity_remaining + ?, 3) WHERE id = ?').run(item.quantity, lot.id);
  recordMovement({
    product_id: lot.product_id, lot_id: lot.id, change: item.quantity, reason: 'treatment_undo',
    treatment_item_id: item.id, note: 'برگشت به انبار با حذفِ ردیفِ پرونده‌ی درمان', created_by: userId,
  });
}

// اجرایِ یه تابع داخلِ تراکنش — اگه وسطش خطا بده، هیچ‌کدوم از تغییرها نمی‌مونه
export function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
