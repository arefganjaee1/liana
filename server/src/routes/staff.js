import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, WRITE_ROLES } from '../auth.js';

const router = Router();

function getHours(staffId) {
  const rows = db.prepare('SELECT weekday, is_off, start_time, end_time FROM staff_hours WHERE staff_id = ? ORDER BY weekday').all(staffId);
  const byDay = {};
  rows.forEach((r) => { byDay[r.weekday] = { is_off: !!r.is_off, start_time: r.start_time, end_time: r.end_time }; });
  // برای روزهایی که هنوز ردیفی ندارن، پیش‌فرض «تعطیل» برمی‌گردونیم تا فرانت مجبور نباشه حدس بزنه
  for (let d = 0; d <= 6; d++) {
    if (!byDay[d]) byDay[d] = { is_off: true, start_time: null, end_time: null };
  }
  return byDay;
}

router.get('/', requireAuth(), (req, res) => {
  const staff = db.prepare('SELECT * FROM staff ORDER BY sort_order, id').all();
  const withHours = staff.map((s) => ({ ...s, active: !!s.active, hours: getHours(s.id) }));
  res.json({ ok: true, staff: withHours });
});

router.post('/', requireAuth(WRITE_ROLES), (req, res) => {
  const { name, role } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'اسم لازمه' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM staff').get().m;
  const info = db.prepare('INSERT INTO staff (name, role, sort_order) VALUES (?, ?, ?)')
    .run(name.trim(), role === 'owner' ? 'owner' : 'staff', maxOrder + 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'پرسنل پیدا نشد' });
  const { name, role, active } = req.body || {};
  db.prepare(`UPDATE staff SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active), updated_at = datetime('now') WHERE id = ?`)
    .run(name ?? null, role ?? null, active === undefined ? null : (active ? 1 : 0), id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM staff WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ساعاتِ هفتگیِ یه پرسنل — آرایه‌ای از ۷ روز، هرکدوم {weekday, is_off, start_time, end_time}
router.put('/:id/hours', requireAuth(WRITE_ROLES), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'پرسنل پیدا نشد' });
  const { days } = req.body || {};
  if (!Array.isArray(days)) return res.status(400).json({ ok: false, error: 'فرمتِ days درست نیست' });

  const upsert = db.prepare(`
    INSERT INTO staff_hours (staff_id, weekday, is_off, start_time, end_time)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(staff_id, weekday) DO UPDATE SET
      is_off = excluded.is_off, start_time = excluded.start_time, end_time = excluded.end_time
  `);
  db.exec('BEGIN');
  try {
    days.forEach((d) => {
      const weekday = Number(d.weekday);
      if (weekday < 0 || weekday > 6) return;
      const isOff = d.is_off ? 1 : 0;
      upsert.run(id, weekday, isOff, isOff ? null : (d.start_time || null), isOff ? null : (d.end_time || null));
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true, hours: getHours(id) });
});

export default router;
