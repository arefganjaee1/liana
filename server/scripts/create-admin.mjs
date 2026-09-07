// یه حسابِ ادمین/منیجرِ جدید می‌سازه (یا اگه از قبل بود، رمزش رو عوض می‌کنه).
// اجرا: node scripts/create-admin.mjs <username> <password> <role: admin|manager> ["اسمِ نمایشی"]
import { db } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const [, , username, password, roleArg, displayName] = process.argv;

if (!username || !password) {
  console.log('استفاده: node scripts/create-admin.mjs <username> <password> <role: admin|manager> ["اسمِ نمایشی"]');
  process.exit(1);
}

const role = roleArg === 'manager' ? 'manager' : 'admin';
const { hash, salt } = hashPassword(password);

const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ?, role = ?, display_name = COALESCE(?, display_name), active = 1 WHERE id = ?')
    .run(hash, salt, role, displayName || null, existing.id);
  console.log(`رمزِ حسابِ «${username}» به‌روزرسانی شد (نقش: ${role}).`);
} else {
  db.prepare('INSERT INTO admin_users (username, password_hash, password_salt, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(username, hash, salt, role, displayName || username);
  console.log(`حسابِ «${username}» با نقشِ «${role}» ساخته شد.`);
}
