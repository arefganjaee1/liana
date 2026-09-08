let CURRENT_USER = null;
let ALL_STAFF = [];
let CURRENT_SERVICE = null; // خدمتی که الان تو مودال باز شده (بعد از ذخیره‌ی اولیه)
let VARIANT_ROWS = []; // آرایه‌ی موقتِ variantها قبلِ ذخیره

const CATEGORY_LABELS = { inj: 'تزریقات', skin: 'پوست و لیزر', 'weight-loss': 'لاغری', massage: 'ماساژ' };

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('services', CURRENT_USER);
  ALL_STAFF = (await apiGet('/admin/staff')).staff;
  await loadServices();

  document.getElementById('addServiceBtn').addEventListener('click', () => openModal(null));
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('saveServiceBtn').addEventListener('click', saveBasic);
  document.getElementById('addVariantBtn').addEventListener('click', () => { addVariantRow(); renderVariants(); });
}

async function loadServices() {
  const { services } = await apiGet('/admin/services');
  const tbody = document.getElementById('servicesBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = services.length ? 'none' : 'flex';
  services.forEach((svc, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td><strong>${escapeHtml(svc.title)}</strong></td>
      <td>${CATEGORY_LABELS[svc.category] || '—'}</td>
      <td>${fmtPrice(svc.price)}</td>
      <td>${svc.duration_minutes ? svc.duration_minutes + ' دقیقه' : '—'}</td>
      <td>${svc.staff.map((s) => escapeHtml(s.name)).join('، ') || '—'}</td>
      <td>${svc.images.length}</td>
      <td><span class="pill ${svc.active ? 'active' : 'inactive'}">${svc.active ? 'فعال' : 'غیرفعال'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm editBtn">${ICON.edit}<span>ویرایش</span></button>
        ${CURRENT_USER.role === 'admin' ? `<button class="btn btn-danger btn-sm delBtn">${ICON.trash}<span>حذف</span></button>` : ''}
      </td>
    `;
    tr.querySelector('.editBtn').addEventListener('click', () => openModal(svc.id));
    tr.querySelector('.delBtn')?.addEventListener('click', () => deleteService(svc.id, svc.title));
    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function deleteService(id, title) {
  if (!confirm(`خدمتِ «${title}» کامل حذف بشه؟ این کار برگشت نداره.`)) return;
  try {
    await apiDelete(`/admin/services/${id}`);
    toast('خدمت حذف شد');
    loadServices();
  } catch (e) { toast(e.message, true); }
}

async function openModal(id) {
  document.getElementById('modalBackdrop').style.display = 'flex';
  VARIANT_ROWS = [];
  if (id) {
    const { service } = await apiGet(`/admin/services/${id}`);
    CURRENT_SERVICE = service;
    document.getElementById('modalTitle').textContent = 'ویرایشِ خدمت';
    document.getElementById('modalSub').textContent = 'تغییرات رو بزن و ذخیره کن.';
    fillForm(service);
    VARIANT_ROWS = service.variants.map((v) => ({ ...v }));
    document.getElementById('afterCreateSections').style.display = 'block';
    renderVariants();
    renderStaffChecks(service.staff.map((s) => s.id));
    renderImages(service.images);
  } else {
    CURRENT_SERVICE = null;
    document.getElementById('modalTitle').textContent = 'افزودنِ خدمتِ جدید';
    document.getElementById('modalSub').textContent = 'اول اطلاعاتِ پایه رو بزن و ذخیره کن، بعد می‌تونی عکس/variant/پرسنل اضافه کنی.';
    fillForm(null);
    document.getElementById('afterCreateSections').style.display = 'none';
  }
}

function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
  loadServices();
}

function fillForm(svc) {
  document.getElementById('f_title').value = svc?.title || '';
  document.getElementById('f_description').value = svc?.description || '';
  document.getElementById('f_category').value = svc?.category || '';
  document.getElementById('f_price').value = svc?.price ?? '';
  document.getElementById('f_duration').value = svc?.duration_minutes ?? '';
  document.getElementById('f_active').checked = svc ? !!svc.active : true;
}

function readForm() {
  return {
    title: document.getElementById('f_title').value.trim(),
    description: document.getElementById('f_description').value.trim() || null,
    category: document.getElementById('f_category').value || null,
    price: document.getElementById('f_price').value === '' ? null : Number(document.getElementById('f_price').value),
    duration_minutes: document.getElementById('f_duration').value === '' ? null : Number(document.getElementById('f_duration').value),
    active: document.getElementById('f_active').checked,
  };
}

async function saveBasic() {
  const data = readForm();
  if (!data.title) { toast('عنوان لازمه', true); return; }
  try {
    if (CURRENT_SERVICE) {
      const { service } = await apiPut(`/admin/services/${CURRENT_SERVICE.id}`, data);
      CURRENT_SERVICE = service;
      toast('ذخیره شد');
    } else {
      const { service } = await apiPost('/admin/services', data);
      CURRENT_SERVICE = service;
      toast('خدمت ساخته شد — حالا می‌تونی عکس/variant/پرسنل اضافه کنی');
      document.getElementById('modalTitle').textContent = 'ویرایشِ خدمت';
      document.getElementById('afterCreateSections').style.display = 'block';
      renderVariants();
      renderStaffChecks([]);
      renderImages([]);
    }
  } catch (e) { toast(e.message, true); }
}

// ===== variantها =====
function addVariantRow() {
  VARIANT_ROWS.push({ title: '', price: null, duration_minutes: null });
}

function renderVariants() {
  const wrap = document.getElementById('variantsList');
  wrap.innerHTML = '';
  VARIANT_ROWS.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML = `
      <input type="text" placeholder="عنوانِ variant" value="${escapeHtml(v.title)}" data-f="title">
      <input type="number" placeholder="قیمت" value="${v.price ?? ''}" data-f="price">
      <input type="number" placeholder="دقیقه" value="${v.duration_minutes ?? ''}" data-f="duration_minutes">
      <button class="btn btn-danger btn-sm" data-act="del">${ICON.trash}<span>حذف</span></button>
    `;
    row.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const f = inp.dataset.f;
        VARIANT_ROWS[i][f] = f === 'title' ? inp.value : (inp.value === '' ? null : Number(inp.value));
      });
    });
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      VARIANT_ROWS.splice(i, 1);
      renderVariants();
      await saveVariants();
    });
    wrap.appendChild(row);
  });
  wrap.insertAdjacentHTML('beforeend', `<button class="btn btn-ghost btn-sm" id="saveVariantsInline" style="margin-top:8px">ذخیره‌ی variantها</button>`);
  document.getElementById('saveVariantsInline')?.addEventListener('click', saveVariants);
}

async function saveVariants() {
  if (!CURRENT_SERVICE) return;
  try {
    await apiPut(`/admin/services/${CURRENT_SERVICE.id}/variants`, { variants: VARIANT_ROWS });
    toast('variantها ذخیره شدن');
  } catch (e) { toast(e.message, true); }
}

// ===== پرسنل =====
function renderStaffChecks(selectedIds) {
  const wrap = document.getElementById('staffCheckList');
  wrap.innerHTML = '';
  if (!ALL_STAFF.length) {
    wrap.innerHTML = '<div class="hint">هنوز پرسنلی تعریف نشده — اول از صفحه‌ی «پرسنل» اضافه‌ش کن.</div>';
    return;
  }
  ALL_STAFF.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'staff-check-row';
    const checked = selectedIds.includes(s.id) ? 'checked' : '';
    row.innerHTML = `<input type="checkbox" id="staffchk_${s.id}" ${checked}> <label for="staffchk_${s.id}">${escapeHtml(s.name)}</label>`;
    row.querySelector('input').addEventListener('change', saveStaffAssignment);
    wrap.appendChild(row);
  });
}

async function saveStaffAssignment() {
  if (!CURRENT_SERVICE) return;
  const ids = ALL_STAFF.filter((s) => document.getElementById(`staffchk_${s.id}`)?.checked).map((s) => s.id);
  try {
    await apiPut(`/admin/services/${CURRENT_SERVICE.id}/staff`, { staff_ids: ids });
    toast('پرسنل به‌روزرسانی شد');
  } catch (e) { toast(e.message, true); }
}

// ===== عکس‌ها =====
const IMAGE_TYPE_LABELS = { sample: 'نمونه', before: 'قبل', after: 'بعد', equipment: 'تجهیزات' };

function renderImages(images) {
  const grid = document.getElementById('imagesGrid');
  grid.innerHTML = '';
  images.forEach((img) => {
    const tile = document.createElement('div');
    tile.className = 'img-tile';
    tile.innerHTML = `
      <img src="${img.url || ('/uploads/' + img.filename)}" alt="">
      <span class="tag">${IMAGE_TYPE_LABELS[img.type] || img.type}</span>
      ${CURRENT_USER.role === 'admin' ? '<button class="del-btn" title="حذف">×</button>' : ''}
    `;
    tile.querySelector('.del-btn')?.addEventListener('click', async () => {
      try {
        await apiDelete(`/admin/services/${CURRENT_SERVICE.id}/images/${img.id}`);
        const { service } = await apiGet(`/admin/services/${CURRENT_SERVICE.id}`);
        CURRENT_SERVICE = service;
        renderImages(service.images);
        toast('عکس حذف شد');
      } catch (e) { toast(e.message, true); }
    });
    grid.appendChild(tile);
  });

  const uploadTile = document.createElement('div');
  uploadTile.className = 'img-upload-tile';
  uploadTile.innerHTML = `
    ${ICON.plus}
    <span>افزودنِ عکس</span>
    <select id="uploadTypeSelect">
      <option value="sample">نمونه</option>
      <option value="before">قبل</option>
      <option value="after">بعد</option>
      <option value="equipment">تجهیزات</option>
    </select>
    <input type="file" accept="image/*" id="uploadFileInput">
  `;
  grid.appendChild(uploadTile);
  const fileInput = uploadTile.querySelector('#uploadFileInput');
  const typeSelect = uploadTile.querySelector('#uploadTypeSelect');
  // تیل قبلاً یه <label> بود که هم select هم input[file] رو دربر می‌گرفت — رفتارِ پیش‌فرضِ
  // مرورگر برایِ label با چند فرزندِ فرم‌دار، کلیک رو به‌جایِ فایل‌اینپوت به select (اولین فرزند) می‌فرسته،
  // یعنی کلیک رو تیل هیچ‌وقت دیالوگِ انتخابِ فایل رو باز نمی‌کرد. برای همین به یه <div> با کلیکِ صریح تغییر کرد.
  uploadTile.addEventListener('click', (e) => {
    if (e.target === typeSelect) return;
    fileInput.click();
  });
  typeSelect.addEventListener('click', (e) => e.stopPropagation());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const type = uploadTile.querySelector('#uploadTypeSelect').value;
    const fd = new FormData();
    fd.append('image', file);
    fd.append('type', type);
    try {
      await apiPost(`/admin/services/${CURRENT_SERVICE.id}/images`, fd);
      const { service } = await apiGet(`/admin/services/${CURRENT_SERVICE.id}`);
      CURRENT_SERVICE = service;
      renderImages(service.images);
      toast('عکس اضافه شد');
    } catch (e) { toast(e.message, true); }
  });
}

init();
