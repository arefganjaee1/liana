const API_BASE = '/api/customer/auth';

async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: 'پاسخِ نامعتبر از سرور' }; }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || 'خطایی پیش اومد');
    err.status = res.status;
    throw err;
  }
  return data;
}

function apiGet(path) { return apiFetch(path); }
function apiPost(path, body) { return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); }
