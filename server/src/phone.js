// نرمال‌سازیِ شماره‌تلفن برای تطبیقِ مشتری‌ها — ارقامِ فارسی/عربی رو لاتین می‌کنه و فاصله/خط‌تیره رو حذف می‌کنه
// (همون نیازِ الگویِ toLatinDigits تو site/card/index.html، اینجا سمتِ سرور و برای مقایسه/ایندکس)
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[۰-۹٠-٩]/g, (ch) => {
    const i = FA_DIGITS.indexOf(ch);
    return String(i > -1 ? i : AR_DIGITS.indexOf(ch));
  });
  s = s.replace(/[\s\-()]/g, '');
  return s || null;
}
