# liana-server

اسکلت اولیه‌ی بک‌اند لیانا — Express + SQLite (`better-sqlite3`).

فعلاً فقط یه endpoint سلامت‌سنجی داره (`GET /api/health`). حساب مشتری، نوبت‌ها، و باشگاه امتیاز
بعداً روی همین اسکلت ساخته می‌شن.

## اجرای لوکال

```bash
npm install
cp .env.example .env
npm run dev
```

بعد تست کن:

```bash
curl http://localhost:3001/api/health
```

## دیپلوی روی سرور (بعداً)

همون الگوی gharzi: `pm2` برای نگه‌داشتن پروسه زنده + `nginx` به‌عنوان reverse proxy جلوش.
فایل دیتابیس (`data/liana.db`) عمداً commit نمی‌شه (تو `.gitignore`ه) — رو هر محیطی جدا ساخته می‌شه.
