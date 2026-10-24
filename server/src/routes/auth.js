import { Router } from 'express';
import { db } from '../db.js';
import {
  verifyPassword, createSession, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, SESSION_COOKIE, requireAuth,
} from '../auth.js';

const router = Router();

// محافظت در برابرِ حدس‌زدنِ رمز: بعد از ۵ تلاشِ اشتباه، همون نام‌کاربری از همون IP ۱۵ دقیقه قفل می‌شه.
// کلید «نام‌کاربری + IP»ـه نه فقط نام‌کاربری، تا کسی نتونه با چند تلاشِ عمدی، ادمینِ واقعی رو بیرون نگه داره.
// IPِ واقعی از هدرِ X-Forwarded-For که nginx می‌فرسته خونده می‌شه (app.set('trust proxy', 'loopback') تو index.js).
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function attemptKey(req, username) {
  return `${String(username).trim().toLowerCase()}|${req.ip || ''}`;
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'نام‌کاربری و رمز لازمه' });
  }
  const key = attemptKey(req, username);
  const attempt = db.prepare('SELECT * FROM admin_login_attempts WHERE attempt_key = ?').get(key);
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60000));
    return res.status(429).json({ ok: false, error: `به‌خاطرِ چند تلاشِ اشتباه، ورود موقتاً قفله. حدودِ ${mins} دقیقه‌ی دیگه دوباره امتحان کن.` });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash, user.password_salt)) {
    const failed = (attempt?.failed || 0) + 1;
    if (failed >= MAX_FAILED) {
      db.prepare(`
        INSERT INTO admin_login_attempts (attempt_key, failed, locked_until, updated_at) VALUES (?, 0, ?, datetime('now'))
        ON CONFLICT(attempt_key) DO UPDATE SET failed = 0, locked_until = excluded.locked_until, updated_at = datetime('now')
      `).run(key, new Date(Date.now() + LOCK_MS).toISOString());
      return res.status(429).json({ ok: false, error: 'به‌خاطرِ چند تلاشِ اشتباه، ورود ۱۵ دقیقه قفل شد.' });
    }
    db.prepare(`
      INSERT INTO admin_login_attempts (attempt_key, failed, locked_until, updated_at) VALUES (?, ?, NULL, datetime('now'))
      ON CONFLICT(attempt_key) DO UPDATE SET failed = excluded.failed, locked_until = NULL, updated_at = datetime('now')
    `).run(key, failed);
    return res.status(401).json({ ok: false, error: 'نام‌کاربری یا رمز اشتباهه' });
  }
  db.prepare('DELETE FROM admin_login_attempts WHERE attempt_key = ?').run(key);
  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
  });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;
