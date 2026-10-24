let CURRENT_USER = null;
let EDIT_PRODUCT_ID = null;   // مودالِ محصول: null = افزودن
let LOT_PRODUCT = null;       // مودالِ ورودِ خرید
let DETAIL_ID = null;         // مودالِ جزئیات
let ADJUST_LOT = null;

const CATEGORY_LABELS = { toxin: 'بوتاکس', filler: 'فیلر', skinbooster: 'اسکین‌بوستر / مزو', consumable: 'مصرفیِ عمومی', other: 'سایر' };
const REASON_LABELS = { purchase: 'خرید', treatment: 'مصرف در درمان', treatment_undo: 'برگشت از پرونده', adjust: 'اصلاحِ شمارش', waste: 'دورریز' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function daysUntil(iso) {
  const today = new Date(LianaJalali.todayISO() + 'T00:00:00Z');
  return Math.round((new Date(iso + 'T00:00:00Z') - today) / 86400000);
}

function expiryCell(iso) {
  if (!iso) return '<span style="color:var(--ink-3)">—</span>';
  const d = daysUntil(iso);
  const color = d < 0 ? 'var(--danger)' : d <= 30 ? 'var(--warn)' : 'inherit';
  const hint = d < 0 ? 'گذشته' : d === 0 ? 'امروز' : `${LianaJalali.faDigits(d)} روزِ دیگه`;
  return `<span style="color:${color}; font-weight:700">${LianaJalali.isoToJalaliDisplay(iso)}</span><br><span style="font-size:11px; color:var(--ink-3)">${hint}</span>`;
}

function statusPills(p) {
  const out = [];
  if (!p.active) out.push('<span class="pill inactive">غیرفعال</span>');
  if (p.active && p.stock <= 0 && !p.has_expired) out.push('<span class="pill st-cancelled">موجودی صفر</span>');
  if (p.has_expired) out.push(`<span class="pill st-cancelled">${fmtQty(p.expired_qty)} منقضی‌شده</span>`);
  if (p.low) out.push('<span class="pill st-pending">کم شده</span>');
  if (p.expiring_soon) out.push('<span class="pill st-pending">نزدیکِ انقضا</span>');
  if (!out.length) out.push('<span class="pill st-confirmed">عادی</span>');
  return out.join(' ');
}

async function init() {
  CURRENT_USER = await requireLogin();
  if (!CURRENT_USER) return;
  await renderShell('inventory', CURRENT_USER);

  LianaJalaliPicker.attach(document.getElementById('l_expiry_display'), document.getElementById('l_expiry'));
  LianaJalaliPicker.attach(document.getElementById('l_received_display'), document.getElementById('l_received'), { allowClear: false });
  attachMoneyInput(document.getElementById('l_cost'));

  document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null));
  document.getElementById('closeProductBtn').addEventListener('click', () => hide('productBackdrop'));
  document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
  document.getElementById('closeLotBtn').addEventListener('click', () => hide('lotBackdrop'));
  document.getElementById('saveLotBtn').addEventListener('click', saveLot);
  document.getElementById('closeDetailBtn').addEventListener('click', () => { hide('detailBackdrop'); loadProducts(); });
  document.getElementById('editProductBtn').addEventListener('click', async () => {
    const { product } = await apiGet(`/admin/inventory/products/${DETAIL_ID}`);
    hide('detailBackdrop');
    openProductModal(product);
  });
  document.getElementById('cancelAdjustBtn').addEventListener('click', () => { document.getElementById('adjustBox').hidden = true; });
  document.getElementById('saveAdjustBtn').addEventListener('click', saveAdjust);
  document.getElementById('showInactive').addEventListener('change', loadProducts);

  await loadProducts();
}

function show(id) { document.getElementById(id).style.display = 'flex'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

async function loadProducts() {
  const all = document.getElementById('showInactive').checked ? '?all=1' : '';
  const { products } = await apiGet(`/admin/inventory/products${all}`);
  const tbody = document.getElementById('productsBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = products.length ? 'none' : 'flex';
  document.getElementById('productsTable').style.display = products.length ? '' : 'none';
  const alerts = products.filter((p) => p.low || p.expiring_soon || p.has_expired).length;
  document.getElementById('listSummary').textContent = `${LianaJalali.faDigits(products.length)} محصول${alerts ? `، ${LianaJalali.faDigits(alerts)} هشدار` : ''}`;

  products.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (!p.active) tr.style.opacity = '.55';
    tr.innerHTML = `
      <td style="color:var(--ink-3); font-variant-numeric:tabular-nums">${i + 1}</td>
      <td><strong>${escapeHtml(p.name)}</strong>${p.brand ? `<br><span style="font-size:11.5px; color:var(--ink-3)">${escapeHtml(p.brand)}</span>` : ''}</td>
      <td>${CATEGORY_LABELS[p.category] || p.category}</td>
      <td style="font-variant-numeric:tabular-nums"><strong>${fmtQty(p.stock)}</strong> ${escapeHtml(p.unit)}${p.low_stock_threshold !== null ? `<br><span style="font-size:11px; color:var(--ink-3)">هشدار زیرِ ${fmtQty(p.low_stock_threshold)}</span>` : ''}</td>
      <td>${expiryCell(p.nearest_expiry)}</td>
      <td>${statusPills(p)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm lotBtn">${ICON.cart}<span>ورودِ خرید</span></button>
        <button class="btn btn-ghost btn-sm detailBtn">${ICON.file}<span>جزئیات</span></button>
      </td>`;
    tr.querySelector('.lotBtn').addEventListener('click', () => openLotModal(p));
    tr.querySelector('.detailBtn').addEventListener('click', () => openDetail(p.id));
    tbody.appendChild(tr);
  });
  updateInventoryBadge();
}

// ===== محصول =====
function openProductModal(p) {
  EDIT_PRODUCT_ID = p ? p.id : null;
  document.getElementById('productModalTitle').textContent = p ? 'ویرایشِ محصول' : 'افزودنِ محصول';
  document.getElementById('p_name').value = p?.name || '';
  document.getElementById('p_brand').value = p?.brand || '';
  document.getElementById('p_category').value = p?.category || 'toxin';
  document.getElementById('p_unit').value = p?.unit || '';
  document.getElementById('p_threshold').value = p && p.low_stock_threshold !== null ? p.low_stock_threshold : '';
  document.getElementById('p_notes').value = p?.notes || '';
  document.getElementById('p_active').checked = p ? !!p.active : true;
  document.getElementById('p_active_row').style.display = p ? '' : 'none';
  show('productBackdrop');
  document.getElementById('p_name').focus();
}

async function saveProduct() {
  const thr = document.getElementById('p_threshold').value.trim();
  const payload = {
    name: document.getElementById('p_name').value.trim(),
    brand: document.getElementById('p_brand').value.trim(),
    category: document.getElementById('p_category').value,
    unit: document.getElementById('p_unit').value.trim(),
    low_stock_threshold: thr === '' ? null : latinDigits(thr),
    notes: document.getElementById('p_notes').value.trim(),
    active: document.getElementById('p_active').checked,
  };
  if (!payload.name) { toast('اسمِ محصول لازمه', true); return; }
  if (!payload.unit) { toast('واحد رو بنویس (مثلاً واحد، سرنگ، سی‌سی)', true); return; }
  try {
    if (EDIT_PRODUCT_ID) {
      await apiPut(`/admin/inventory/products/${EDIT_PRODUCT_ID}`, payload);
      toast('ذخیره شد');
    } else {
      await apiPost('/admin/inventory/products', payload);
      toast('محصول اضافه شد — حالا با «ورودِ خرید» موجودیش رو ثبت کن');
    }
    hide('productBackdrop');
    loadProducts();
  } catch (e) { toast(e.message, true); }
}

// ===== ورودِ خرید =====
function openLotModal(p) {
  LOT_PRODUCT = p;
  document.getElementById('lotModalSub').textContent = `${p.name}${p.brand ? ' (' + p.brand + ')' : ''} — موجودیِ فعلی ${fmtQty(p.stock)} ${p.unit}`;
  document.getElementById('l_unit').textContent = `(${p.unit})`;
  ['l_qty', 'l_lot', 'l_cost', 'l_supplier', 'l_note', 'l_expiry', 'l_expiry_display'].forEach((id) => { document.getElementById(id).value = ''; });
  const today = LianaJalali.todayISO();
  document.getElementById('l_received').value = today;
  document.getElementById('l_received_display').value = LianaJalali.isoToJalaliDisplay(today);
  show('lotBackdrop');
  document.getElementById('l_qty').focus();
}

async function saveLot() {
  const qty = parseAmount(document.getElementById('l_qty').value);
  if (!qty || Number.isNaN(qty) || qty <= 0) { toast(`مقدار رو به ${LOT_PRODUCT.unit} بنویس`, true); return; }
  const expiry = document.getElementById('l_expiry').value;
  if (!expiry && !confirm('تاریخِ انقضا وارد نشده. برایِ بوتاکس و فیلر خیلی مهمه که ثبت بشه. بدونِ انقضا ذخیره بشه؟')) return;
  const cost = parseAmount(document.getElementById('l_cost').value);
  try {
    await apiPost(`/admin/inventory/products/${LOT_PRODUCT.id}/lots`, {
      quantity: qty,
      lot_number: document.getElementById('l_lot').value.trim(),
      expiry_date: expiry || null,
      received_at: document.getElementById('l_received').value,
      unit_cost: cost && !Number.isNaN(cost) ? cost : null,
      supplier: document.getElementById('l_supplier').value.trim(),
      note: document.getElementById('l_note').value.trim(),
    });
    toast('خرید ثبت شد');
    hide('lotBackdrop');
    loadProducts();
  } catch (e) { toast(e.message, true); }
}

// ===== جزئیات: سری‌ها + تاریخچه =====
async function openDetail(id) {
  DETAIL_ID = id;
  document.getElementById('adjustBox').hidden = true;
  const { product: p, lots, movements } = await apiGet(`/admin/inventory/products/${id}`);
  document.getElementById('detailTitle').textContent = `${p.name}${p.brand ? ' — ' + p.brand : ''}`;
  document.getElementById('detailSub').textContent = `${CATEGORY_LABELS[p.category] || ''}، موجودیِ قابلِ‌مصرف: ${fmtQty(p.stock)} ${p.unit}${p.has_expired ? `، ${fmtQty(p.expired_qty)} ${p.unit} منقضی‌شده که هنوز دورریز ثبت نشده` : ''}`;

  const lb = document.getElementById('lotsBody');
  lb.innerHTML = '';
  if (!lots.length) lb.innerHTML = '<tr><td colspan="6" style="color:var(--ink-3)">هنوز خریدی ثبت نشده.</td></tr>';
  lots.forEach((l) => {
    const tr = document.createElement('tr');
    if (l.quantity_remaining <= 0) tr.style.opacity = '.5';
    tr.innerHTML = `
      <td dir="ltr" style="text-align:right">${escapeHtml(l.lot_number || '—')}</td>
      <td>${expiryCell(l.expiry_date)}</td>
      <td style="font-variant-numeric:tabular-nums"><strong>${fmtQty(l.quantity_remaining)}</strong> / ${fmtQty(l.quantity_received)} ${escapeHtml(p.unit)}</td>
      <td>${l.unit_cost !== null ? fmtPrice(l.unit_cost) : '—'}</td>
      <td>${LianaJalali.isoToJalaliDisplay(l.received_at)}${l.supplier ? `<br><span style="font-size:11px; color:var(--ink-3)">${escapeHtml(l.supplier)}</span>` : ''}</td>
      <td><button class="btn btn-ghost btn-sm adjBtn">${ICON.edit}<span>اصلاح</span></button></td>`;
    tr.querySelector('.adjBtn').addEventListener('click', () => openAdjust(l, p));
    lb.appendChild(tr);
  });

  const mb = document.getElementById('movesBody');
  mb.innerHTML = '';
  if (!movements.length) mb.innerHTML = '<tr><td colspan="5" style="color:var(--ink-3)">هنوز ورود و خروجی نبوده.</td></tr>';
  movements.forEach((m) => {
    const tr = document.createElement('tr');
    const when = m.created_at ? LianaJalali.isoToJalaliDisplay(m.created_at.slice(0, 10)) : '';
    const color = m.change > 0 ? 'var(--ok)' : 'var(--danger)';
    const desc = [
      m.customer_name ? `${escapeHtml(m.customer_name)}${m.booking_date ? '، نوبتِ ' + LianaJalali.isoToJalaliDisplay(m.booking_date) : ''}` : '',
      m.note ? escapeHtml(m.note) : '',
      m.by_name ? `<span style="color:var(--ink-3)">ثبت: ${escapeHtml(m.by_name)}</span>` : '',
    ].filter(Boolean).join(' — ');
    tr.innerHTML = `
      <td>${when}</td>
      <td>${REASON_LABELS[m.reason] || m.reason}</td>
      <td dir="ltr" style="text-align:right; color:${color}; font-weight:700; font-variant-numeric:tabular-nums">${m.change > 0 ? '+' : ''}${fmtQty(m.change)}</td>
      <td dir="ltr" style="text-align:right">${escapeHtml(m.lot_number || '—')}</td>
      <td style="font-size:12px">${desc || '—'}</td>`;
    mb.appendChild(tr);
  });
  show('detailBackdrop');
}

function openAdjust(lot, product) {
  ADJUST_LOT = lot;
  document.getElementById('adjustTitle').textContent = `اصلاحِ موجودیِ سریِ ${lot.lot_number || 'بدونِ شماره'} (الان ${fmtQty(lot.quantity_remaining)} ${product.unit})`;
  document.getElementById('a_change').value = '';
  document.getElementById('a_note').value = '';
  document.getElementById('a_reason').value = lot.expiry_date && daysUntil(lot.expiry_date) < 0 ? 'waste' : 'adjust';
  document.getElementById('adjustBox').hidden = false;
  document.getElementById('a_change').focus();
}

async function saveAdjust() {
  const raw = latinDigits(document.getElementById('a_change').value).replace(/\s/g, '').replace('−', '-');
  const change = Number(raw);
  if (!raw || Number.isNaN(change) || change === 0) { toast('یه عدد بنویس؛ برایِ کم‌کردن با منفی، مثلاً -5', true); return; }
  try {
    await apiPost(`/admin/inventory/lots/${ADJUST_LOT.id}/adjust`, {
      change, reason: document.getElementById('a_reason').value, note: document.getElementById('a_note').value.trim(),
    });
    toast('موجودی اصلاح شد');
    openDetail(DETAIL_ID);
  } catch (e) { toast(e.message, true); }
}

init();
