let CURRENT_USER = null;
let CURRENT_EDIT_ID = null; // آیدیِ پرسنلی که تو مودالِ افزودن/ویرایش بازه (null = افزودنِ جدید)
let CURRENT_HOURS_STAFF = null; // آبجکتِ کاملِ پرسنلی که مودالِ ساعاتش بازه

const DAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('staff', CURRENT_USER);
  await loadStaff();

  document.getElementById('addStaffBtn').addEventListener('click', () => openStaffModal(null));
  document.getElementById('closeStaffModalBtn').addEventListener('click', closeStaffModal);
  document.getElementById('saveStaffBtn').addEventListener('click', saveStaff);
  document.getElementById('closeHoursModalBtn').addEventListener('click', closeHoursModal);
  document.getElementById('saveHoursBtn').addEventListener('click', saveHours);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadStaff() {
  const { staff } = await apiGet('/admin/staff');
  const tbody = document.getElementById('staffBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = staff.length ? 'none' : 'flex';
  staff.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td><span class="pill ${s.role === 'owner' ? 'owner' : 'staff'}">${s.role === 'owner' ? 'صاحب/مدیر' : 'پرسنل'}</span></td>
      <td><span class="pill ${s.active ? 'active' : 'inactive'}">${s.active ? 'فعال' : 'غیرفعال'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm hoursBtn">${ICON.clock}<span>ساعاتِ کاری</span></button>
        <button class="btn btn-ghost btn-sm editBtn">${ICON.edit}<span>ویرایش</span></button>
        ${CURRENT_USER.role === 'admin' ? `<button class="btn btn-danger btn-sm delBtn">${ICON.trash}<span>حذف</span></button>` : ''}
      </td>
    `;
    tr.querySelector('.hoursBtn').addEventListener('click', () => openHoursModal(s));
    tr.querySelector('.editBtn').addEventListener('click', () => openStaffModal(s));
    tr.querySelector('.delBtn')?.addEventListener('click', () => deleteStaff(s.id, s.name));
    tbody.appendChild(tr);
  });
}

// ===== مودالِ افزودن/ویرایشِ پرسنل =====
function openStaffModal(s) {
  CURRENT_EDIT_ID = s ? s.id : null;
  document.getElementById('staffModalTitle').textContent = s ? 'ویرایشِ پرسنل' : 'افزودنِ پرسنل';
  document.getElementById('s_name').value = s?.name || '';
  document.getElementById('s_role').value = s?.role || 'staff';
  document.getElementById('s_active_row').style.display = s ? 'flex' : 'none';
  document.getElementById('s_active').checked = s ? !!s.active : true;
  document.getElementById('staffModalBackdrop').style.display = 'flex';
}

function closeStaffModal() {
  document.getElementById('staffModalBackdrop').style.display = 'none';
}

async function saveStaff() {
  const name = document.getElementById('s_name').value.trim();
  if (!name) { toast('اسم لازمه', true); return; }
  const role = document.getElementById('s_role').value;
  try {
    if (CURRENT_EDIT_ID) {
      const active = document.getElementById('s_active').checked;
      await apiPut(`/admin/staff/${CURRENT_EDIT_ID}`, { name, role, active });
      toast('ذخیره شد');
    } else {
      await apiPost('/admin/staff', { name, role });
      toast('پرسنل اضافه شد');
    }
    closeStaffModal();
    loadStaff();
  } catch (e) { toast(e.message, true); }
}

async function deleteStaff(id, name) {
  if (!confirm(`«${escapeHtml(name)}» از لیستِ پرسنل حذف بشه؟ از خدماتی هم که بهش وصله جدا می‌شه.`)) return;
  try {
    await apiDelete(`/admin/staff/${id}`);
    toast('حذف شد');
    loadStaff();
  } catch (e) { toast(e.message, true); }
}

// ===== مودالِ ساعاتِ کاریِ هفتگی =====
function openHoursModal(s) {
  CURRENT_HOURS_STAFF = s;
  document.getElementById('hoursStaffName').textContent = s.name;
  renderHoursGrid(s.hours);
  document.getElementById('hoursModalBackdrop').style.display = 'flex';
}

function closeHoursModal() {
  document.getElementById('hoursModalBackdrop').style.display = 'none';
}

function renderHoursGrid(hours) {
  const grid = document.getElementById('hoursGrid');
  grid.innerHTML = '';
  for (let d = 0; d <= 6; d++) {
    const day = hours[d] || { is_off: true, start_time: null, end_time: null };
    const row = document.createElement('div');
    row.className = 'hours-row' + (day.is_off ? ' is-off' : '');
    row.dataset.weekday = d;
    row.innerHTML = `
      <span class="day-name">${DAY_NAMES[d]}</span>
      <label class="checkbox-row" style="gap:5px">
        <input type="checkbox" class="offChk" ${day.is_off ? 'checked' : ''}>
        <span style="font-size:11.5px; color:var(--ink-3)">تعطیل</span>
      </label>
      <input type="time" class="startInp" dir="ltr" value="${day.start_time || '09:00'}">
      <input type="time" class="endInp" dir="ltr" value="${day.end_time || '18:00'}">
    `;
    row.querySelector('.offChk').addEventListener('change', (e) => {
      row.classList.toggle('is-off', e.target.checked);
    });
    grid.appendChild(row);
  }
}

async function saveHours() {
  if (!CURRENT_HOURS_STAFF) return;
  const rows = document.querySelectorAll('#hoursGrid .hours-row');
  const days = Array.from(rows).map((row) => ({
    weekday: Number(row.dataset.weekday),
    is_off: row.querySelector('.offChk').checked,
    start_time: row.querySelector('.startInp').value || null,
    end_time: row.querySelector('.endInp').value || null,
  }));
  try {
    await apiPut(`/admin/staff/${CURRENT_HOURS_STAFF.id}/hours`, { days });
    toast('ساعاتِ کاری ذخیره شد');
    closeHoursModal();
    loadStaff();
  } catch (e) { toast(e.message, true); }
}

init();
