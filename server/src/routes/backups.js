import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { backupDir, listBackups, runBackup, isValidBackupName } from '../backup.js';

// فقط ادمین: لیست، ساختِ دستی و دانلودِ بک‌آپ‌هایِ دیتابیس
const router = Router();

router.get('/', requireAuth('admin'), (req, res) => {
  res.json({ ok: true, backups: listBackups() });
});

router.post('/', requireAuth('admin'), (req, res) => {
  try {
    const name = runBackup({ manual: true });
    res.json({ ok: true, name, backups: listBackups() });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'ساختِ بک‌آپ شکست خورد: ' + e.message });
  }
});

router.get('/:name', requireAuth('admin'), (req, res) => {
  const name = req.params.name;
  if (!isValidBackupName(name)) return res.status(400).json({ ok: false, error: 'اسمِ فایل نامعتبره' });
  res.download(path.join(backupDir, name), name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ ok: false, error: 'فایل پیدا نشد' });
  });
});

export default router;
