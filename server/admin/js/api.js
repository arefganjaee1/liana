const API_BASE = '/api';

// آیکون‌های خطی هم‌زبان‌با‌سایت (stroke-width:1.8، گردِ سرِ خط، بدونِ fill) — برای دکمه‌های جدول/فرم استفاده می‌شن
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 15v5Z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7 10 4h4l2 3"/><circle cx="12" cy="13.5" r="3.3"/></svg>',
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
    throw new Error(data.error || 'خطایی پیش اومد');
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
}
