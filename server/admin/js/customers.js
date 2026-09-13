let CURRENT_USER = null;
let CURRENT_EDIT_ID = null;
let SEARCH_TIMER = null;

const CONSENT_LABELS = { yes: 'بله', no: 'خیر', not_asked: 'پرسیده نشده' };
const CONSENT_CLASS = { yes: 'pc-yes', no: 'pc-no', not_asked: 'pc-unknown' };
const REFERRAL_PRESETS = ['اینستاگرام', 'معرفیِ دوستان و آشنایان', 'جست‌وجوی گوگل', 'تابلو / رهگذر'];

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('customers', CURRENT_USER);

  await loadCustomers('');

  document.getElementById('addCustomerBtn').addEventListener('click', () => openModal(null));
  document.getElementById('closeCustomerModalBtn').addEventListener('click', closeModal);
  document.getElementById('saveCustomerBtn').addEventListener('click', saveCustomer);
  document.getElementById('c_referral').addEventListener('change', onReferralChange);
  LianaJalaliPicker.attach(document.getElementById('c_birthday_display'), document.getElementById('c_birthday'));
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(SEARCH_TIMER);
    const val = e.target.value;
    SEARCH_TIMER = setTimeout(() => loadCustomers(val), 280);
  });

  // اگه از یه لینکِ مستقیم (مثلاً از صفحه‌ی نوبت‌ها) با ?id= اومده باشیم، همون مشتری رو باز کن
  const params = new URLSearchParams(location.search);
  const directId = params.get('id');
  if (directId) {
    try {
      const { customer } = await apiGet(`/admin/customers/${directId}`);
      openModal(customer);
    } catch (e) { /* اگه پیدا نشد، بی‌سروصدا رد شو */ }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadCustomers(q) {
  const query = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const { customers } = await apiGet(`/admin/customers${query}`);
  const tbody = document.getElementById('customersBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = customers.length ? 'none' : 'flex';
  document.getElementById('listSummary').textContent = `${LianaJalali.faDigits(customers.length)} مشتری`;

  customers.forEach((c, i) => {
    const tr = document.createElement('tr');
    const consentClass = CONSENT_CLASS[c.photo_consent] || 'pc-unknown';
    const consentLabel = CONSENT_LABELS[c.photo_consent] || 'پرسیده نشده';
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td style="direction:ltr; text-align:right; font-variant-numeric:tabular-nums">${c.phone ? escapeHtml(c.phone) : '—'}</td>
      <td style="font-variant-numeric:tabular-nums">${LianaJalali.faDigits(c.visit_count || 0)}</td>
      <td>${c.last_visit_date ? LianaJalali.isoToJalaliDisplay(c.last_visit_date) : '—'}</td>
      <td><span class="pill ${consentClass}">${consentLabel}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm editBtn">${ICON.edit}<span>ویرایش</span></button>
        ${CURRENT_USER.role === 'admin' ? `<button class="btn btn-danger btn-sm delBtn">${ICON.trash}<span>حذف</span></button>` : ''}
      </td>
    `;
    tr.querySelector('.editBtn').addEventListener('click', async () => {
      const { customer } = await apiGet(`/admin/customers/${c.id}`);
      openModal(customer);
    });
    tr.querySelector('.delBtn')?.addEventListener('click', () => deleteCustomer(c.id, c.name));
    tbody.appendChild(tr);
  });
}

async function deleteCustomer(id, name) {
  if (!confirm(`پروفایلِ «${escapeHtml(name)}» کامل حذف بشه؟ نوبت‌های قبلیش پاک نمی‌شن، فقط از این پروفایل جدا می‌شن.`)) return;
  try {
    await apiDelete(`/admin/customers/${id}`);
    toast('مشتری حذف شد');
    loadCustomers(document.getElementById('searchInput').value);
  } catch (e) { toast(e.message, true); }
}

function onReferralChange() {
  const isOther = document.getElementById('c_referral').value === '__other';
  document.getElementById('c_referral_other').style.display = isOther ? 'block' : 'none';
}

function renderHistory(bookings) {
  const section = document.getElementById('c_history_section');
  const body = document.getElementById('c_history_body');
  const emptyMsg = document.getElementById('c_history_empty');
  section.style.display = 'block';
  body.innerHTML = '';
  if (!bookings || !bookings.length) {
    emptyMsg.style.display = 'block';
    document.getElementById('c_history_table').style.display = 'none';
    return;
  }
  emptyMsg.style.display = 'none';
  document.getElementById('c_history_table').style.display = '';
  const STATUS_LABELS = { pending: 'در انتظارِ تایید', confirmed: 'تایید شده', done: 'انجام شد', cancelled: 'لغو شده' };
  const STATUS_CLASS = { pending: 'st-pending', confirmed: 'st-confirmed', done: 'st-done', cancelled: 'st-cancelled' };
  bookings.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${LianaJalali.isoToJalaliDisplay(b.booking_date)}${b.booking_time ? ' — ' + LianaJalali.faDigits(b.booking_time) : ''}</td>
      <td>${escapeHtml(b.service_title)}</td>
      <td>${b.staff_name ? escapeHtml(b.staff_name) : '—'}</td>
      <td><span class="pill ${STATUS_CLASS[b.status] || ''}">${STATUS_LABELS[b.status] || b.status}</span></td>
    `;
    body.appendChild(tr);
  });
}

function openModal(c) {
  CURRENT_EDIT_ID = c ? c.id : null;
  document.getElementById('customerModalTitle').textContent = c ? 'ویرایشِ مشتری' : 'افزودنِ مشتری';
  document.getElementById('c_phone_hint').textContent = '';

  document.getElementById('c_name').value = c?.name || '';
  document.getElementById('c_phone').value = c?.phone || '';
  document.getElementById('c_birthday').value = c?.birthday || '';
  document.getElementById('c_birthday_display').value = c?.birthday ? LianaJalali.isoToJalaliDisplay(c.birthday) : '';
  document.getElementById('c_address').value = c?.address || '';
  document.getElementById('c_allergies').value = c?.allergies_notes || '';
  document.getElementById('c_medical').value = c?.medical_notes || '';
  document.getElementById('c_consent').value = c?.photo_consent || 'not_asked';
  document.getElementById('c_notes').value = c?.notes || '';

  const refSel = document.getElementById('c_referral');
  const refOther = document.getElementById('c_referral_other');
  if (c?.referral_source && !REFERRAL_PRESETS.includes(c.referral_source)) {
    refSel.value = '__other';
    refOther.value = c.referral_source;
    refOther.style.display = 'block';
  } else {
    refSel.value = c?.referral_source || '';
    refOther.value = '';
    refOther.style.display = 'none';
  }

  if (c) {
    renderHistory(c.bookings || []);
  } else {
    document.getElementById('c_history_section').style.display = 'none';
  }

  document.getElementById('customerModalBackdrop').style.display = 'flex';
}

function closeModal() {
  document.getElementById('customerModalBackdrop').style.display = 'none';
}

async function saveCustomer() {
  const name = document.getElementById('c_name').value.trim();
  if (!name) { toast('نامِ مشتری لازمه', true); return; }

  const refSel = document.getElementById('c_referral').value;
  const referral = refSel === '__other' ? document.getElementById('c_referral_other').value.trim() : refSel;

  const payload = {
    name,
    phone: document.getElementById('c_phone').value.trim() || null,
    birthday: document.getElementById('c_birthday').value || null,
    address: document.getElementById('c_address').value.trim() || null,
    referral_source: referral || null,
    allergies_notes: document.getElementById('c_allergies').value.trim() || null,
    medical_notes: document.getElementById('c_medical').value.trim() || null,
    photo_consent: document.getElementById('c_consent').value,
    notes: document.getElementById('c_notes').value.trim() || null,
  };

  try {
    if (CURRENT_EDIT_ID) {
      await apiPut(`/admin/customers/${CURRENT_EDIT_ID}`, payload);
      toast('ذخیره شد');
    } else {
      await apiPost('/admin/customers', payload);
      toast('مشتری ثبت شد');
    }
    closeModal();
    loadCustomers(document.getElementById('searchInput').value);
  } catch (e) { toast(e.message, true); }
}

init();
