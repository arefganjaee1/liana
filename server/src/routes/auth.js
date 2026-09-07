import { Router } from 'express';
import { db } from '../db.js';
import {
  verifyPassword, createSession, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, SESSION_COOKIE, requireAuth,
} from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'نام‌کاربری و رمز لازمه' });
  }
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return res.status(401).json({ ok: false, error: 'نام‌کاربری یا رمز اشتباهه' });
  }
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
