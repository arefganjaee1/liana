const STATUS_LABELS = { pending: 'در انتظارِ تایید', confirmed: 'تایید شده', done: 'انجام شد', cancelled: 'لغو شده' };

function faDigits(n) {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

async function init() {
  let data;
  try {
    data = await apiGet('/me');
  } catch (e) {
    window.location.href = '/portal/login.html';
    return;
  }

  document.getElementById('customerName').textContent = data.customer.name;
  document.getElementById('pointsNum').textContent = faDigits(data.points);

  const list = document.getElementById('historyList');
  const empty = document.getElementById('emptyState');
  if (!data.bookings.length) {
    empty.hidden = false;
  } else {
    data.bookings.forEach((b) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const dateStr = LianaJalali.isoToJalaliDisplay(b.booking_date);
      item.innerHTML = `
        <div class="info">
          <span class="service">${escapeHtml(b.service_title)}</span>
          <span class="meta">${dateStr}${b.booking_time ? ' — ' + faDigits(b.booking_time) : ''}${b.staff_name ? ' · ' + escapeHtml(b.staff_name) : ''}</span>
        </div>
        <span class="pill ${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
      `;
      list.appendChild(item);
    });
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiPost('/logout', {});
    window.location.href = '/portal/login.html';
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
