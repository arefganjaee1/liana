let CURRENT_USER = null;
let ALL_SERVICES = [];
let ALL_STAFF = [];
let CURRENT_EDIT_ID = null;

const STATUS_LABELS = { pending: 'در انتظارِ تایید', confirmed: 'تایید شده', done: 'انجام شد', cancelled: 'لغو شده' };
const STATUS_CLASS = { pending: 'st-pending', confirmed: 'st-confirmed', done: 'st-done', cancelled: 'st-cancelled' };

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('consultations', CURRENT_USER);

  ALL_SERVICES = (await apiGet('/admin/services')).services;
  ALL_STAFF = (await apiGet('/admin/staff')).staff;

  LianaJalaliPicker.attach(document.getElementById('b_date_display'), document.getElementById('b_date'));

  await loadConsultations();

  document.getElementById('closeBookingModalBtn').addEventListener('click', closeModal);
  document.getElementById('saveBookingBtn').addEventListener('click', saveBooking);
  document.getElementById('b_service').addEventListener('change', onServiceSelectChange);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"\x27]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "\x27": '&#39;' }[c]));
}

// created_at رو SQLite به‌وقتِ UTC ذخیره می‌کنه — برایِ نمایشِ درست به‌وقتِ ایران (+۰۳:۳۰) تبدیل می‌شه
function createdAtLocalParts(createdAtUtc) {
  const d = new Date(createdAtUtc.replace(' ', 'T') + 'Z');
  const local = new Date(d.getTime() + 3.5 * 60 * 60 * 1000);
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

async function loadConsultations() {
  const { bookings } = await apiGet('/admin/bookings?status=pending');
  // جدیدترین درخواست بالا
  bookings.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const tbody = document.getElementById('consultBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = bookings.length ? 'none' : 'flex';
  document.getElementById('listSummary').textContent = bookings.length
    ? `${bookings.length} درخواستِ در‌انتظار`
    : '';

  bookings.forEach((b, i) => {
    const { date, time } = createdAtLocalParts(b.created_at);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td class="customer-cell">${b.customer_id
        ? `<strong class="customer-link" data-customer-id="${b.customer_id}">${escapeHtml(b.customer_name)}</strong>`
        : `<strong>${escapeHtml(b.customer_name)}</strong>`}${b.customer_phone ? `<span>${escapeHtml(b.customer_phone)}</span>` : ''}</td>
      <td>${escapeHtml(b.service_title)}</td>
      <td style="max-width:260px; white-space:normal">${escapeHtml(b.note || '—')}</td>
      <td class="dt-cell"><span class="d">${LianaJalali.isoToJalaliDisplay(date)}</span><span class="t">${LianaJalali.faDigits(time)}</span></td>
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
      try {
        await apiPut(`/admin/bookings/${b.id}`, { status: statusSelect.value });
        toast('وضعیت به‌روزرسانی شد');
        loadConsultations();
      } catch (e) { toast(e.message, true); loadConsultations(); }
    });
    statusCell.appendChild(statusSelect);

    tr.querySelector('.editBtn').addEventListener('click', () => openModal(b));
    tr.querySelector('.delBtn')?.addEventListener('click', () => deleteBooking(b.id, b.customer_name));
    tr.querySelector('.customer-link')?.addEventListener('click', () => {
      window.location.href = `/admin/customers.html?id=${b.customer_id}`;
    });
    tbody.appendChild(tr);
  });
}

async function deleteBooking(id, name) {
  if (!confirm(`درخواستِ «${escapeHtml(name)}» کامل حذف بشه؟ اگه فقط منصرف شده، بهتره به‌جاش وضعیتش رو «لغو شده» کنی.`)) return;
  try {
    await apiDelete(`/admin/bookings/${id}`);
    toast('حذف شد');
    loadConsultations();
  } catch (e) { toast(e.message, true); }
}

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
  CURRENT_EDIT_ID = b.id;
  document.getElementById('bookingModalTitle').textContent = 'ویرایشِ درخواست';

  fillServiceSelect(b.service_id);
  fillStaffSelect(b.staff_id);
  onServiceSelectChange();

  document.getElementById('b_name').value = b.customer_name || '';
  document.getElementById('b_phone').value = b.customer_phone || '';
  document.getElementById('b_service_free').value = !b.service_id ? (b.service_title || '') : '';
  const initialDate = b.booking_date || LianaJalali.todayISO();
  document.getElementById('b_date').value = initialDate;
  document.getElementById('b_date_display').value = LianaJalali.isoToJalaliDisplay(initialDate);
  document.getElementById('b_time').value = b.booking_time || '';
  document.getElementById('b_status').value = b.status || 'pending';
  document.getElementById('b_note').value = b.note || '';

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
    await apiPut(`/admin/bookings/${CURRENT_EDIT_ID}`, payload);
    toast('ذخیره شد');
    closeModal();
    loadConsultations();
  } catch (e) { toast(e.message, true); }
}

init();
