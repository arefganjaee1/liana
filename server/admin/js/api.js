const API_BASE = '/api';

// آیکون‌های خطی هم‌زبان‌با‌سایت (stroke-width:1.8، گردِ سرِ خط، بدونِ fill) — برای دکمه‌های جدول/فرم استفاده می‌شن
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 15v5Z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7 10 4h4l2 3"/><circle cx="12" cy="13.5" r="3.3"/></svg>',
  idcard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.2"/><circle cx="9" cy="11" r="2.3"/><path d="M5.5 16c.5-2 2-3 3.5-3s3 1 3.5 3"/><path d="M15 10h4M15 13.5h4"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M12 9v6M9 12h6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>',
};

async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.location.href = '/admin/login.html';
    throw new Error('لاگین لازمه');
  }
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: 'پاسخِ نامعتبر از سرور' }; }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || 'خطایی پیش اومد');
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

function apiGet(path) { return apiFetch(path); }
function apiPost(path, body) { return apiFetch(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }); }
function apiPut(path, body) { return apiFetch(path, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body) }); }
function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }

function toast(msg, isError) {
  let el = document.getElementById('globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ===== عدد و پول =====
// ارقامِ فارسی/عربی → لاتین
function latinDigits(str) {
  return String(str ?? '').replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
}
// متنِ ورودیِ مبلغ («۲٬۵۰۰٬۰۰۰» یا «2,500,000») → عدد، یا null اگه خالی/نامعتبر بود
function parseAmount(v) {
  const s = latinDigits(v).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
// اینپوتِ مبلغ: موقعِ تایپ با جداکننده‌ی هزارگان نشون داده می‌شه
function attachMoneyInput(input) {
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('dir', 'ltr');
  input.addEventListener('input', () => {
    const digits = latinDigits(input.value).replace(/\D/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  });
}
function fmtQty(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 3 });
}

function fmtPrice(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fa-IR') + ' تومان';
}

async function requireLogin() {
  try {
    const { user } = await apiGet('/auth/me');
    return user;
  } catch (e) {
    window.location.href = '/admin/login.html';
    return null;
  }
}

async function renderShell(activeKey, user) {
  const shell = document.getElementById('shellRoot');
  if (!shell) return;
  const roleFa = user.role === 'admin' ? 'ادمین' : 'منیجر';
  shell.querySelector('.who').textContent = user.display_name || user.username;
  shell.querySelector('.role-badge').textContent = roleFa;
  shell.querySelectorAll('nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.key === activeKey);
    if (a.dataset.adminOnly === '1' && user.role !== 'admin') a.style.display = 'none';
  });
  shell.querySelector('.logout-btn').addEventListener('click', async () => {
    await apiPost('/auth/logout', {});
    window.location.href = '/admin/login.html';
  });

  // اعلانِ سادهِ درون‌پنلی: تعدادِ درخواست‌هایِ «در انتظارِ تایید» رو کنارِ لینکِ «مشاوره» نشون می‌ده —
  // نه پیامک نه ایمیل، فقط همین که پنل رو باز کنی خودش به‌روزه؛ هر ۴۵ ثانیه هم تا وقتی تب بازه رفرش می‌شه.
  updateConsultationBadge();
  updateInventoryBadge();
  if (!window._consultBadgeTimer) {
    window._consultBadgeTimer = setInterval(() => { updateConsultationBadge(); updateInventoryBadge(); }, 45000);
  }
}

function setNavBadge(key, n) {
  const link = document.querySelector(`.sidebar nav a[data-key="${key}"]`);
  if (!link) return;
  let badge = link.querySelector('.nav-badge');
  if (n > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      link.appendChild(badge);
    }
    badge.textContent = n > 99 ? '۹۹+' : String(n);
  } else {
    badge?.remove();
  }
}

// هشدارِ انبار: تعدادِ محصولاتی که کم شدن، رو به انقضان، یا سریِ منقضی‌شده دارن
async function updateInventoryBadge() {
  try {
    const { count } = await apiGet('/admin/inventory/alerts');
    setNavBadge('inventory', count);
  } catch (e) { /* کمکیه؛ نباید پنل رو مختل کنه */ }
}

async function updateConsultationBadge() {
  try {
    const { bookings } = await apiGet('/admin/bookings?status=pending');
    setNavBadge('consultations', bookings.length);
  } catch (e) {
    // یه اعلانِ کمکیه؛ اگه شکست خورد نباید کلِ پنل رو مختل کنه
  }
}
