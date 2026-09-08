import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 14;

// ===== هشِ پسورد — با crypto.scrypt خودِ Node، بدون هیچ پکیجِ خارجی/نیتیو =====
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ===== سشن‌ها =====
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  const user = db.prepare('SELECT id, username, role, display_name, active FROM admin_users WHERE id = ?').get(session.user_id);
  if (!user || !user.active) return null;
  return user;
}

// ===== پارسِ کوکی، بدون نیاز به پکیجِ cookie-parser =====
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

export const SESSION_COOKIE = 'liana_session';

export function setSessionCookie(res, token, expiresISO) {
  const expires = new Date(expiresISO).toUTCString();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

// ===== میدل‌ور: نیاز به لاگین (و اختیاری: نقش/نقش‌های مجاز) =====
// role می‌تونه یه رشته باشه (مثلاً 'admin') یا یه آرایه (مثلاً ['admin','manager']).
// 'admin' همیشه سوپرستِ هر نقشیه، صرف‌نظر از اینکه role چی باشه.
export function requireAuth(role) {
  return (req, res, next) => {
    const cookies = parseCookies(req);
    const user = getSessionUser(cookies[SESSION_COOKIE]);
    if (!user) return res.status(401).json({ ok: false, error: 'لاگین لازمه' });
    if (role) {
      const allowed = Array.isArray(role) ? role : [role];
      if (!allowed.includes(user.role) && user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'دسترسی کافی نداری' });
      }
    }
    req.user = user;
    next();
  };
}

// نقش‌هایی که اجازه‌ی «افزودن/ویرایش» دارن (منیجر + ادمین) — برای POST/PUTِ محتوا
export const WRITE_ROLES = ['admin', 'manager'];
