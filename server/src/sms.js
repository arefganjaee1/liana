// ماژولِ ارسالِ پیامک — عمداً قابلِ‌تعویض (adapter pattern) تا وصل‌کردنِ یه سرویسِ واقعیِ OTP
// (مثلاً کاوه‌نگار) فقط نیازمندِ نوشتنِ یه تابعِ جدید باشه، نه دست‌بردن تو کدِ روت‌ها.
//
// تا وقتی SMS_PROVIDER تنظیم نشده (یا API key نداره)، حالتِ "mock" فعاله: کد رو
// به‌جایِ پیامکِ واقعی، فقط تو لاگِ سرور چاپ می‌کنه — یعنی پیامکِ واقعی ارسال نمی‌شه.
// این یادآوریِ صادقانه‌ست، نه یه fallbackِ قابلِ‌استفاده تو محیطِ زنده.

const PROVIDER = process.env.SMS_PROVIDER || 'mock';

async function sendViaMock(phone, text) {
  // امنیتِ صریح: تو محیطِ زنده هرگز نباید بی‌صدا وانمود کنیم پیامک رفته در حالی که نرفته —
  // اگه رو VPS متغیرِ SMS_PROVIDER/کلیدِ واقعی تنظیم نشده باشه، پورتال باید صریح خطا بده، نه mock کنه.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('سرویسِ پیامکِ واقعی هنوز وصل نشده (SMS_PROVIDER/کلیدِ API تنظیم نشده)');
  }
  console.log(`[SMS:mock] به ${phone} → ${text}  (پیامکِ واقعی ارسال نشد — SMS_PROVIDER تنظیم نشده)`);
  return { ok: true, mock: true };
}

// نمونه‌ی آماده برایِ کاوه‌نگار (Verify Lookup) — وقتی KAVENEGAR_API_KEY ست بشه فعال می‌شه.
// مستنداتِ دقیقِ endpoint/templateId رو باید موقعِ ثبت‌نامِ واقعی از پنلِ کاوه‌نگار چک کرد.
async function sendViaKavenegar(phone, text, { code } = {}) {
  const apiKey = process.env.KAVENEGAR_API_KEY;
  const templateId = process.env.KAVENEGAR_OTP_TEMPLATE;
  if (!apiKey) throw new Error('KAVENEGAR_API_KEY تنظیم نشده');
  const url = templateId
    ? `https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json?receptor=${encodeURIComponent(phone)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(templateId)}`
    : `https://api.kavenegar.com/v1/${apiKey}/sms/send.json?receptor=${encodeURIComponent(phone)}&message=${encodeURIComponent(text)}&sender=`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.return?.status !== 200) {
    throw new Error(`ارسالِ پیامک با کاوه‌نگار شکست خورد: ${JSON.stringify(data)}`);
  }
  return { ok: true, provider: 'kavenegar', raw: data };
}

export async function sendOtpSms(phone, code) {
  const text = `کدِ ورودِ شما به پروفایلِ کلینیکِ لیانا: ${code}`;
  if (PROVIDER === 'kavenegar') return sendViaKavenegar(phone, text, { code });
  return sendViaMock(phone, text);
}

export const smsProviderInfo = () => ({ provider: PROVIDER, isMock: PROVIDER === 'mock' });
