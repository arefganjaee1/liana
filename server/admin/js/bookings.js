let CURRENT_USER = null;
let ALL_SERVICES = [];
let ALL_STAFF = [];
let CURRENT_EDIT_ID = null; // آیدیِ نوبتی که تو مودال بازه (null = ثبتِ نوبتِ جدید)
let VIEW_MODE = 'day'; // 'day' | 'all'
let VIEW_DATE = null; // 'YYYY-MM-DD' — فقط وقتی VIEW_MODE === 'day'

const STATUS_LABELS = { pending: 'در انتظارِ تایید', confirmed: 'تایید شده', done: 'انجام شد', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'st-pending', confirmed: 'st-confirmed', done: 'st-done', cancelled: 'st-cancelled' };

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('bookings', CURRENT_USER);

  ALL_SERVICES = (await apiGet('/admin/services')).services;
  ALL_STAFF = (await apiGet('/admin/staff')).staff;

  VIEW_DATE = LianaJalali.todayISO();
  document.getElementById('dateJumpInput').value = VIEW_DATE;
  updateDateEcho();

  await loadBookings();

  document.getElementById('addBookingBtn').addEventListener('click', () => openModal(null));
  document.getElementById('closeBookingModalBtn').addEventListener('click', closeModal);
  document.getElementById('saveBookingBtn').addEventListener('click', saveBooking);
  document.getElementById('b_service').addEventListener('change', onServiceSelectChange);
  document.getElementById('b_date').addEventListener('input', () => {
    document.getElementById('b_date_echo').textContent = LianaJalali.isoToJalaliDisplay(document.getElementById('b_date').value);
  });

  document.getElementById('todayBtn').addEventListener('click', () => {
    VIEW_MODE = 'day';
    VIEW_DATE = LianaJalali.todayISO();
    document.getElementById('dateJumpInput').value = VIEW_DATE;
    updateDateEcho();
    syncToolbarButtons();
    loadBookings();
  });
  document.getElementById('allBtn').addEventListener('click', () => {
    VIEW_MODE = 'all';
    syncToolbarButtons();
    loadBookings();
  });
  document.getElementById('dateJumpInput').addEventListener('change', (e) => {
    if (!e.target.value) return;
    VIEW_MODE = 'day';
    VIEW_DATE = e.target.value;
    updateDateEcho();
    syncToolbarButtons();
    loadBookings();
  });

  syncToolbarButtons();
}

function syncToolbarButtons() {
  const isToday = VIEW_MODE === 'day' && VIEW_DATE === LianaJalali.todayISO();
  document.getElementById('todayBtn').classList.toggle('active-filter', isToday);
  document.getElementById('allBtn').classList.toggle('active-filter', VIEW_MODE === 'all');
}

function updateDateEcho() {
  document.getElementById('dateJumpEcho').textContent = VIEW_DATE ? LianaJalali.isoToJalaliDisplay(VIEW_DATE, true) : '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadBookings() {
  const query = VIEW_MODE === 'day' ? `?date=${encodeURIComponent(VIEW_DATE)}` : '';
  const { bookings } = await apiGet(`/admin/bookings${query}`);
  const tbody = document.getElementById('bookingsBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = bookings.length ? 'none' : 'flex';
  document.getElementById('emptyStateText').textContent = VIEW_MODE === 'day'
    ? 'هنوز نوبتی برایِ این روز ثبت نشده.'
    : 'هنوز هیچ نوبتی ثبت نشده.';
  document.getElementById('listSummary').textContent = VIEW_MODE === 'day'
    ? `${LianaJalali.faDigits(bookings.length)} نوبت`
    : `${LianaJalali.faDigits(bookings.length)} نوبت (همه‌ی تاریخ‌ها)`;

  bookings.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td class="customer-cell"><strong>${escapeHtml(b.customer_name)}</strong>${b.customer_phone ? `<span>${escapeHtml(b.customer_phone)}</span>` : ''}</td>
      <td>${escapeHtml(b.service_title)}${b.staff_name ? '' : ''}</td>
      <td>${b.staff_name ? escapeHtml(b.staff_name) : '—'}</td>
      <td class="dt-cell"><span class="d">${LianaJalali.isoToJalaliDisplay(b.booking_date)}</span>${b.booking_time ? `<span class="t">${LianaJalali.faDigits(b.booking_time)}</span>` : ''}</td>
      <td></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm editBtn">${ICON.edit}<span>ویرایش</span></button>
        ${CURRENT_USER.role === 'admin' ? `<button class="btn btn-danger btn-sm delBtn">${ICON.trash}<span>حذف</span></button>` : ''}
      </td>
    `;
    const statusCell = tr.children[5];
    const statusSelect = document.createElement('select');
    statusSelect.className = `status-select pill ${STATUS_CLASS[b.status] || ''}`;
    Object.entries(STATUS_LABELS).forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === b.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusSelect.addEventListener('change', async () => {
      const newClass = STATUS_CLASS[statusSelect.value] || '';
      statusSelect.className = `status-select pill ${newClass}`;
      try {
        await apiPut(`/admin/bookings/${b.id}`, { status: statusSelect.value });
        toast('وضعیت به‌روزرسانی شد');
      } catch (e) { toast(e.message, true); loadBookings(); }
    });
    statusCell.appendChild(statusSelect);

    tr.querySelector('.editBtn').addEventListener('click', () => openModal(b));
    tr.querySelector('.delBtn')?.addEventListener('click', () => deleteBooking(b.id, b.customer_name));
    tbody.appendChild(tr);
  });
}

async function deleteBooking(id, name) {
  if (!confirm(`نوبتِ «${escapeHtml(name)}» کامل حذف بشه؟ اگه فقط منصرف شده، بهتره به‌جاش وضعیتش رو «لغو شده» کنی.`)) return;
  try {
    await apiDelete(`/admin/bookings/${id}`);
    toast('نوبت حذف شد');
    loadBookings();
  } catch (e) { toast(e.message, true); }
}

// ===== مودالِ افزودن/ویرایش =====
function fillServiceSelect(selectedServiceId) {
  const sel = document.getElementById('b_service');
  sel.innerHTML = '';
  const freeOpt = document.createElement('option');
  freeOpt.value = ''; freeOpt.textContent = 'سایر (تایپِ آزاد) — مثلاً مشاوره';
  sel.appendChild(freeOpt);
  ALL_SERVICES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.title;
    sel.appendChild(opt);
  });
  sel.value = selectedServiceId ? String(selectedServiceId) : '';
}

function fillStaffSelect(selectedStaffId) {
  const sel = document.getElementById('b_staff');
  sel.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = 'نامشخص';
  sel.appendChild(noneOpt);
  ALL_STAFF.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.name;
    sel.appendChild(opt);
  });
  sel.value = selectedStaffId ? String(selectedStaffId) : '';
}

function onServiceSelectChange() {
  const isFree = document.getElementById('b_service').value === '';
  document.getElementById('b_service_free_row').style.display = isFree ? 'flex' : 'none';
}

function openModal(b) {
  CURRENT_EDIT_ID = b ? b.id : null;
  document.getElementById('bookingModalTitle').textContent = b ? 'ویرایشِ نوبت' : 'ثبتِ نوبتِ جدید';

  fillServiceSelect(b ? b.service_id : null);
  fillStaffSelect(b ? b.staff_id : null);
  onServiceSelectChange();

  document.getElementById('b_name').value = b?.customer_name || '';
  document.getElementById('b_phone').value = b?.customer_phone || '';
  document.getElementById('b_service_free').value = b && !b.service_id ? (b.service_title || '') : '';
  document.getElementById('b_date').value = b?.booking_date || (VIEW_MODE === 'day' ? VIEW_DATE : LianaJalali.todayISO());
  document.getElementById('b_date_echo').textContent = LianaJalali.isoToJalaliDisplay(document.getElementById('b_date').value);
  document.getElementById('b_time').value = b?.booking_time || '';
  document.getElementById('b_status').value = b?.status || 'confirmed';
  document.getElementById('b_note').value = b?.note || '';

  document.getElementById('bookingModalBackdrop').style.display = 'flex';
}

function closeModal() {
  document.getElementById('bookingModalBackdrop').style.display = 'none';
}

async function saveBooking() {
  const name = document.getElementById('b_name').value.trim();
  if (!name) { toast('نامِ مشتری لازمه', true); return; }
  const date = document.getElementById('b_date').value;
  if (!date) { toast('تاریخِ نوبت لازمه', true); return; }

  const serviceVal = document.getElementById('b_service').value;
  const serviceId = serviceVal ? Number(serviceVal) : null;
  const serviceFree = document.getElementById('b_service_free').value.trim();
  if (!serviceId && !serviceFree) { toast('عنوانِ خدمت لازمه (یا از لیست انتخاب کن یا آزاد بنویس)', true); return; }

  const staffVal = document.getElementById('b_staff').value;

  const payload = {
    customer_name: name,
    customer_phone: document.getElementById('b_phone').value.trim() || null,
    service_id: serviceId,
    service_title: serviceId ? undefined : serviceFree,
    staff_id: staffVal ? Number(staffVal) : null,
    booking_date: date,
    booking_time: document.getElementById('b_time').value || null,
    status: document.getElementById('b_status').value,
    note: document.getElementById('b_note').value.trim() || null,
  };

  try {
    if (CURRENT_EDIT_ID) {
      await apiPut(`/admin/bookings/${CURRENT_EDIT_ID}`, payload);
      toast('ذخیره شد');
    } else {
      await apiPost('/admin/bookings', payload);
      toast('نوبت ثبت شد');
    }
    closeModal();
    loadBookings();
  } catch (e) { toast(e.message, true); }
}

init();
