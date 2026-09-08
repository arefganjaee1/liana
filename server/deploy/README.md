# دیپلویِ پنلِ ادمین + بک‌اند رو VPS

این راهنما مالِ اولین دیپلویِ واقعیِ `server/` رو سرورِ زنده‌ست (تا الان فقط لوکال تست شده: سندباکسِ ابری + مکِ کاربر).
ساب‌دامینِ انتخاب‌شده (طبقِ تصمیمِ کاربر — «یه ساب‌دامینِ جدا»): **`panel.liana.arefprojects.ir`**

من (Claude) به این سرور SSH ندارم، پس همه‌ی مراحلِ زیر باید خودِ کاربر رو سرور اجرا کنه.

## ۱. رکوردِ DNS

تو پنلِ **Cloud Host Iran** (همون پنلی که `liana.arefprojects.ir` و `card.liana.arefprojects.ir` توش تعریف شدن):
- یه رکوردِ `A` جدید بساز: `panel.liana` → `193.39.9.180` (همون IPِ سروری که بقیه‌ی ساب‌دامین‌ها روشن).
- چند دقیقه صبر کن تا پخش بشه، بعد چک کن: `dig +short panel.liana.arefprojects.ir` باید همون IP رو برگردونه.

## ۲. کد رو سرور

```bash
cd /var/www/liana-repo
git pull
cd server
npm install --production
```

## ۳. فایلِ `.env` رو سرور

```bash
cp .env.example .env
```
مقدارهای پیش‌فرض (`PORT=3001`, `DB_PATH=./data/liana.db`) خوبن؛ فقط قبلش چک کن پورتِ ۳۰۰۱ رو سرور آزاده:
```bash
sudo ss -tlnp | grep 3001
```
اگه چیزِ دیگه‌ای اونجا گوش می‌ده، تو `.env` یه پورتِ آزاد بذار (مثلاً `3002`) و همون رو تو کانفیگِ nginx (مرحله‌ی ۵) هم عوض کن.

## ۴. حسابِ ادمینِ واقعی (فقط یه‌بار)

**مهم:** حساب‌های `testadmin`/`testmanager` فقط برای تستِ لوکال بودن؛ اینجا باید یه حسابِ واقعی با رمزِ قوی ساخته بشه:
```bash
node scripts/create-admin.mjs <username-واقعی> <رمزِ-قوی> admin "دکتر فرناز گنجایی"
```
رمز رو یه‌جایِ امن (نه تو چت) نگه دار.

## ۵. کانفیگِ nginx

فایلِ `server/deploy/panel.liana.arefprojects.ir.conf` (همین پوشه) رو کپی کن:
```bash
sudo cp /var/www/liana-repo/server/deploy/panel.liana.arefprojects.ir.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/panel.liana.arefprojects.ir.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```
اگه پورتِ سرویس رو مرحله‌ی ۳ عوض کردی، تو همین فایل هم `proxy_pass http://127.0.0.1:3001;` رو به همون پورتِ جدید تغییر بده.

## ۶. SSL با Certbot

دقیقاً همون الگویی که برایِ `liana.arefprojects.ir` قبلاً جواب داده:
```bash
sudo certbot --nginx -d panel.liana.arefprojects.ir
```
Certbot خودش بلاکِ ۴۴۳ + ریدایرکتِ http→https رو به فایلِ nginx اضافه می‌کنه.

## ۷. نگه‌داشتنِ پروسه با pm2

همون الگویی که تو پروژه‌ی «gharzi» استفاده شده:
```bash
cd /var/www/liana-repo/server
pm2 start src/index.js --name liana-panel
pm2 save
```
(اگه `pm2 startup` قبلاً رو این سرور اجرا نشده، یه‌بار هم اون رو اجرا کن تا بعدِ ریبوتِ سرور هم پروسه بالا بیاد.)

## ۸. تستِ نهایی

- `https://panel.liana.arefprojects.ir/admin/` باید صفحه‌ی لاگین رو نشون بده.
- با حسابِ واقعیِ مرحله‌ی ۴ لاگین کن، چک کن خدمات/پرسنلی که تو سندباکس ایمپورت شدن (۸ خدمتِ جدید) درست دیده می‌شن.
- بعدِ تأییدِ نهایی، حساب‌های تستِ لوکال (`testadmin`/`testmanager`) رو دیتابیسِ لوکالت (نه رو VPS — اونجا اصلاً ساخته نمی‌شن) می‌تونی نگه داری یا پاک کنی، فرقی نداره چون دیتابیسِ لوکال جدا از دیتابیسِ VPS‌ه.
