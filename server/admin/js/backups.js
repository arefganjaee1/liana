let CURRENT_USER = null;

function fmtSize(bytes) {
  if (bytes < 1024) return `${LianaJalali.faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 0 })} کیلوبایت`;
  return `${(bytes / 1024 / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`;
}

function fmtWhen(isoUtc) {
  const d = new Date(isoUtc);
  const dateIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' }).format(d);
  return `${LianaJalali.isoToJalaliDisplay(dateIso)} — ${time}`;
}

function render(backups) {
  const tbody = document.getElementById('backupsBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = backups.length ? 'none' : 'flex';
  document.getElementById('backupsTable').style.display = backups.length ? '' : 'none';
  backups.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td dir="ltr" style="text-align:right; font-variant-numeric:tabular-nums">${b.name}${i === 0 ? ' <span class="pill st-confirmed">آخرین</span>' : ''}</td>
      <td>${fmtWhen(b.created_at)}</td>
      <td>${fmtSize(b.size)}</td>
      <td><a class="btn btn-ghost btn-sm" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>${ICON.download}<span>دانلود</span></a></td>`;
    tbody.appendChild(tr);
  });
}

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  if (CURRENT_USER.role !== 'admin') { window.location.href = '/admin/bookings.html'; return; }
  await renderShell('backups', CURRENT_USER);
  const { backups } = await apiGet('/admin/backups');
  render(backups);
  document.getElementById('backupNowBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await apiPost('/admin/backups', {});
      render(res.backups);
      toast('بک‌آپ ساخته شد');
    } catch (err) { toast(err.message, true); }
    btn.disabled = false;
  });
}

init();
