// بک‌آپِ خودکارِ روزانه‌ی دیتابیس.
//
// هر روز یه کپیِ سالم و کامل از دیتابیس تو data/backups/liana-YYYY-MM-DD.db ساخته می‌شه
// (با VACUUM INTO، که حتی وسطِ کارِ سرور هم یه نسخه‌ی یکدست می‌ده)، و فقط ۳۰ تایِ آخر نگه داشته می‌شه.
// چک هر ۶ ساعت و یه بار هم چند ثانیه بعد از روشن‌شدنِ سرور اجرا می‌شه؛ اگه بک‌آپِ امروز باشه کاری نمی‌کنه.
//
// مهم: بک‌آپی که فقط رو همین سرور باشه، با از دست رفتنِ سرور از دست می‌ره. برایِ همین ادمین از
// صفحه‌ی «بک‌آپ» تو پنل می‌تونه دانلودش کنه و یه جایِ دیگه نگه داره.
//
// عکس‌هایِ آپلودشده (data/uploads) جزوِ این بک‌آپ نیستن.

import fs from 'node:fs';
import path from 'node:path';
import { db, dbFilePath } from './db.js';

export const backupDir = path.join(path.dirname(dbFilePath), 'backups');
const KEEP = 30;
const NAME_RE = /^liana-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/;

function todayStamp() {
  // تاریخِ تهران، نه UTC — تا «بک‌آپِ امروز» با روزِ کاریِ کلینیک بخونه
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function isValidBackupName(name) {
  return NAME_RE.test(name);
}

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(isValidBackupName)
    .map((name) => {
      const st = fs.statSync(path.join(backupDir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function prune() {
  const all = listBackups();
  all.slice(KEEP).forEach((b) => {
    try { fs.unlinkSync(path.join(backupDir, b.name)); } catch (e) { /* بعداً دوباره امتحان می‌شه */ }
  });
}

// manual=true: حتی اگه بک‌آپِ امروز هست، یه نسخه‌ی جدید با ساعت بساز (برایِ دکمه‌ی «همین الان»)
export function runBackup({ manual = false } = {}) {
  fs.mkdirSync(backupDir, { recursive: true });
  const day = todayStamp();
  let name = `liana-${day}.db`;
  if (fs.existsSync(path.join(backupDir, name))) {
    if (!manual) return null;
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/:/g, '');
    name = `liana-${day}-${t}.db`;
  }
  const target = path.join(backupDir, name);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  prune();
  return name;
}

export function startBackupSchedule() {
  const tick = () => {
    try {
      const made = runBackup();
      if (made) console.log(`[backup] ساخته شد: ${made}`);
    } catch (e) {
      console.error('[backup] شکست خورد:', e.message);
    }
  };
  setTimeout(tick, 10 * 1000).unref();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}
