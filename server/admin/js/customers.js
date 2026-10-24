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
  document.getElementById('c_portal_activate').addEventListener('click', activatePortalAccess);
  document.getElementById('c_portal_disable').addEventListener('click', disablePortalAccess);
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
      <td>${balancePill(c.balance)}</td>
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

// مانده‌ی حساب: مثبت = بدهکار، منفی = بستانکار (اضافه پرداخت/بیعانه‌ی استفاده‌نشده)
function balancePill(bal) {
  if (!bal) return '<span style="color:var(--ink-3)">—</span>';
  if (bal > 0) return `<span class="pill st-pending">بدهکار ${Number(bal).toLocaleString('fa-IR')}</span>`;
  return `<span class="pill pc-yes">بستانکار ${Number(-bal).toLocaleString('fa-IR')}</span>`;
}

function renderFinance(c) {
  const sec = document.getElementById('c_fin_section');
  sec.hidden = false;
  const f = c.finance || { total_price: 0, total_paid: 0, balance: 0 };
  const pill = document.getElementById('c_fin_pill');
  if (f.balance > 0) { pill.className = 'pill st-pending'; pill.textContent = 'بدهکار'; }
  else if (f.balance < 0) { pill.className = 'pill pc-yes'; pill.textContent = 'بستانکار'; }
  else { pill.className = 'pill pc-unknown'; pill.textContent = 'تسویه'; }
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  document.getElementById('c_fin_text').innerHTML = f.total_price || f.total_paid
    ? `جمعِ مبلغِ نوبت‌ها <b>${fa(f.total_price)}</b>، پرداختی <b>${fa(f.total_paid)}</b>، ${f.balance > 0 ? `مانده <b>${fa(f.balance)}</b> تومان` : f.balance < 0 ? `<b>${fa(-f.balance)}</b> تومان بیشتر پرداخت کرده` : 'حساب صافه'}`
    : 'هنوز مبلغ یا پرداختی برایِ این مشتری ثبت نشده.';

  const body = document.getElementById('c_treat_body');
  body.innerHTML = '';
  const list = c.treatments || [];
  document.getElementById('c_treat_empty').style.display = list.length ? 'none' : 'block';
  document.getElementById('c_treat_table').style.display = list.length ? '' : 'none';
  list.forEach((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${LianaJalali.isoToJalaliDisplay(t.booking_date)}</td>
      <td>${escapeHtml(t.product_name)}</td>
      <td style="font-variant-numeric:tabular-nums">${t.quantity !== null ? `${fmtQty(t.quantity)} ${escapeHtml(t.unit || '')}` : '—'}</td>
      <td>${escapeHtml(t.area || '—')}</td>
      <td><span dir="ltr">${escapeHtml(t.lot_number || '—')}</span>${t.expiry_date ? `<br><span style="font-size:11px; color:var(--ink-3)">${LianaJalali.isoToJalaliDisplay(t.expiry_date)}</span>` : ''}</td>`;
    body.appendChild(tr);
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
    renderPortal(c.portal, c.phone);
    renderFinance(c);
  } else {
    document.getElementById('c_fin_section').hidden = true;
    document.getElementById('c_history_section').style.display = 'none';
    document.getElementById('c_portal_section').hidden = true;
  }

  document.getElementById('customerModalBackdrop').style.display = 'flex';
}

// ===== ورود به پروفایلِ آنلاین (رمزِ پیش‌فرضِ ۱۲۳۴۵۶ با مهلتِ ۱۵ دقیقه) =====
function faTime(iso) {
  return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

function renderPortal(portal, phone) {
  const section = document.getElementById('c_portal_section');
  const pill = document.getElementById('c_portal_pill');
  const text = document.getElementById('c_portal_text');
  const actBtn = document.getElementById('c_portal_activate');
  const disBtn = document.getElementById('c_portal_disable');
  section.hidden = false;
  const p = portal || { status: 'inactive' };

  actBtn.disabled = !phone;
  disBtn.style.display = p.status === 'inactive' ? 'none' : '';

  if (!phone) {
    pill.className = 'pill pc-unknown'; pill.textContent = 'غیرفعال';
    text.innerHTML = 'برایِ فعال‌سازیِ ورود، اول شماره‌ی موبایلِ مشتری رو ثبت و ذخیره کن.';
    actBtn.textContent = 'فعال‌سازی';
    return;
  }

  let msg = '';
  if (p.status === 'inactive') {
    pill.className = 'pill pc-unknown'; pill.textContent = 'غیرفعال';
    msg = 'مشتری هنوز نمی‌تونه وارد پروفایلش بشه. وقتی کنارِ شماست «فعال‌سازی» رو بزن و بهش بگو با شماره‌ش و رمزِ <b>۱۲۳۴۵۶</b> وارد بشه. همون اوّل ازش خواسته می‌شه رمزِ خودش رو بذاره. رمزِ پیش‌فرض فقط ۱۵ دقیقه معتبره.';
    actBtn.textContent = 'فعال‌سازی';
  } else if (p.status === 'pending') {
    pill.className = 'pill st-pending'; pill.textContent = 'منتظرِ تعیینِ رمز';
    msg = `رمزِ <b>۱۲۳۴۵۶</b> تا ساعتِ <b>${faTime(p.activation_expires_at)}</b> معتبره. اگه مشتری تا اون موقع وارد نشه و رمزش رو نذاره، باید دوباره فعالش کنی.`;
    actBtn.textContent = 'فعال‌سازیِ دوباره';
  } else if (p.status === 'expired') {
    pill.className = 'pill pc-no'; pill.textContent = 'مهلت تموم شد';
    msg = 'مهلتِ ۱۵ دقیقه‌ای گذشت و رمزِ پیش‌فرض دیگه کار نمی‌کنه. برایِ ورودِ مشتری، دوباره فعالش کن.';
    actBtn.textContent = 'فعال‌سازیِ دوباره';
  } else {
    pill.className = 'pill pc-yes'; pill.textContent = 'فعال';
    msg = 'مشتری رمزِ خودش رو گذاشته و کسی جز خودش اون رو نمی‌دونه. اگه رمزش یادش رفت، «ریستِ رمز» رو بزن: رمز برمی‌گرده به <b>۱۲۳۴۵۶</b> و ۱۵ دقیقه وقت داره عوضش کنه.';
    actBtn.textContent = 'ریستِ رمز';
  }
  if (p.locked_until) {
    msg += ` <br>به‌خاطرِ چند تلاشِ اشتباه، ورود تا ساعتِ <b>${faTime(p.locked_until)}</b> قفله. فعال‌سازی یا ریست قفل رو هم باز می‌کنه.`;
  }
  text.innerHTML = msg;
}

async function activatePortalAccess() {
  if (!CURRENT_EDIT_ID) return;
  const pillText = document.getElementById('c_portal_pill').textContent;
  if (pillText === 'فعال' && !confirm('رمزِ این مشتری ریست بشه؟ رمزِ فعلیش باطل می‌شه، از همه‌ی دستگاه‌ها خارج می‌شه، و ۱۵ دقیقه وقت داره با ۱۲۳۴۵۶ وارد بشه و رمزِ جدید بذاره.')) return;
  try {
    const { portal } = await apiPost(`/admin/customers/${CURRENT_EDIT_ID}/portal/activate`, {});
    renderPortal(portal, document.getElementById('c_phone').value.trim());
    toast('فعال شد — رمزِ ۱۲۳۴۵۶ تا ۱۵ دقیقه معتبره');
  } catch (e) { toast(e.message, true); }
}

async function disablePortalAccess() {
  if (!CURRENT_EDIT_ID) return;
  if (!confirm('ورودِ این مشتری به پروفایلِ آنلاین غیرفعال بشه؟ از همه‌ی دستگاه‌ها خارج می‌شه.')) return;
  try {
    const { portal } = await apiPost(`/admin/customers/${CURRENT_EDIT_ID}/portal/disable`, {});
    renderPortal(portal, document.getElementById('c_phone').value.trim());
    toast('ورود غیرفعال شد');
  } catch (e) { toast(e.message, true); }
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
