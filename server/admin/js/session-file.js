// پرونده‌ی هر نوبت (مودالِ صفحه‌ی نوبت‌ها): درمانِ انجام‌شده + پرداخت‌ها.
// SessionFile.open(bookingId, user, onChange) — onChange بعد از بستن صدا زده می‌شه تا جدولِ نوبت‌ها تازه بشه.
const SessionFile = (() => {
  const METHOD_LABELS = { cash: 'نقد', card: 'کارتخوان', transfer: 'کارت‌به‌کارت' };
  const KIND_LABELS = { payment: 'پرداخت', deposit: 'بیعانه', refund: 'بازپرداخت' };
  const NO_PRODUCT = '__none';
  let BOOKING_ID = null;
  let USER = null;
  let DATA = null;
  let ON_CHANGE = null;
  let wired = false;

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toLocaleString('fa-IR');

  function wire() {
    if (wired) return;
    wired = true;
    attachMoneyInput(el('f_price'));
    attachMoneyInput(el('p_amount'));
    LianaJalaliPicker.attach(el('p_date_display'), el('p_date'), { allowClear: false });
    el('t_product').addEventListener('change', onProductChange);
    el('t_add').addEventListener('click', () => addTreatment(true));
    el('p_add').addEventListener('click', addPayment);
    el('f_price_save').addEventListener('click', savePrice);
    el('closeFileBtn').addEventListener('click', close);
  }

  async function open(bookingId, user, onChange) {
    wire();
    BOOKING_ID = bookingId;
    USER = user;
    ON_CHANGE = onChange;
    try {
      const d = await apiGet(`/admin/bookings/${bookingId}/file`);
      render(d, true);
      el('fileBackdrop').style.display = 'flex';
    } catch (e) { toast(e.message, true); }
  }

  function close() {
    el('fileBackdrop').style.display = 'none';
    if (ON_CHANGE) ON_CHANGE();
  }

  function render(d, resetForms) {
    DATA = d;
    const b = d.booking;
    el('fileTitle').textContent = `پرونده‌ی ${b.customer_name}`;
    el('fileSub').textContent = [
      b.service_title,
      `${LianaJalali.isoToJalaliDisplay(b.booking_date)}${b.booking_time ? ' — ' + LianaJalali.faDigits(b.booking_time) : ''}`,
      b.staff_name,
    ].filter(Boolean).join('، ');

    // ----- درمان -----
    const tb = el('tBody');
    tb.innerHTML = '';
    if (!d.treatments.length) tb.innerHTML = '<tr><td colspan="5" style="color:var(--ink-3)">هنوز چیزی ثبت نشده.</td></tr>';
    d.treatments.forEach((t) => {
      const tr = document.createElement('tr');
      const lot = t.lot_number || t.expiry_date
        ? `<span dir="ltr">${esc(t.lot_number || '—')}</span>${t.expiry_date ? `<span class="t-sub">انقضا ${LianaJalali.isoToJalaliDisplay(t.expiry_date)}</span>` : ''}`
        : '—';
      const stockNote = t.product_id && !t.deducted ? '<span class="t-sub" style="color:var(--warn)">از انبار کم نشده</span>' : '';
      tr.innerHTML = `
        <td><strong>${esc(t.product_name)}</strong>${stockNote}</td>
        <td style="font-variant-numeric:tabular-nums">${t.quantity !== null ? `${fmtQty(t.quantity)} ${esc(t.unit || '')}` : '—'}</td>
        <td>${esc(t.area || '—')}</td>
        <td>${lot}</td>
        <td><button class="btn btn-danger btn-sm" type="button">${ICON.trash}</button></td>`;
      tr.querySelector('button').addEventListener('click', () => deleteTreatment(t));
      tb.appendChild(tr);
    });

    // ----- انتخابِ محصول -----
    const sel = el('t_product');
    const prev = resetForms ? '' : sel.value;
    sel.innerHTML = '';
    if (d.products.length) {
      d.products.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = `${p.name}${p.brand ? ' (' + p.brand + ')' : ''} — ${fmtQty(p.stock)} ${p.unit}`;
        sel.appendChild(o);
      });
    }
    const none = document.createElement('option');
    none.value = NO_PRODUCT;
    none.textContent = d.products.length ? 'کارِ بدونِ محصول (مثلاً RF، ماساژ)' : 'کارِ بدونِ محصول (هنوز محصولی تو انبار نیست)';
    sel.appendChild(none);
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    onProductChange();
    if (resetForms) { el('t_qty').value = ''; el('t_area').value = ''; el('t_name').value = ''; }

    // ----- مالی -----
    const f = d.finance;
    el('f_price').value = b.price !== null ? Number(b.price).toLocaleString('en-US') : '';
    el('f_paid').textContent = `${money(f.paid)} تومان`;
    const bal = el('f_balance');
    if (f.balance === null) { bal.textContent = 'مبلغ تعیین نشده'; bal.style.color = 'var(--ink-3)'; }
    else if (f.balance > 0) { bal.textContent = `${money(f.balance)} تومان`; bal.style.color = 'var(--warn)'; }
    else if (f.balance < 0) { bal.textContent = `${money(-f.balance)} تومان اضافه پرداخت`; bal.style.color = 'var(--ok)'; }
    else { bal.textContent = 'تسویه'; bal.style.color = 'var(--ok)'; }

    const pb = el('pBody');
    pb.innerHTML = '';
    if (!d.payments.length) pb.innerHTML = '<tr><td colspan="6" style="color:var(--ink-3)">هنوز پرداختی ثبت نشده.</td></tr>';
    d.payments.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${LianaJalali.isoToJalaliDisplay(p.paid_at)}</td>
        <td>${METHOD_LABELS[p.method] || p.method}</td>
        <td>${KIND_LABELS[p.kind] || p.kind}</td>
        <td style="font-variant-numeric:tabular-nums; font-weight:700; color:${p.amount < 0 ? 'var(--danger)' : 'inherit'}">${money(p.amount)}</td>
        <td style="font-size:12px">${esc(p.note || '')}${p.by_name ? `<span class="t-sub">ثبت: ${esc(p.by_name)}</span>` : ''}</td>
        <td>${USER.role === 'admin' ? `<button class="btn btn-danger btn-sm" type="button">${ICON.trash}</button>` : ''}</td>`;
      tr.querySelector('button')?.addEventListener('click', () => deletePayment(p));
      pb.appendChild(tr);
    });
    if (resetForms) {
      el('p_amount').value = f.balance > 0 ? Number(f.balance).toLocaleString('en-US') : '';
      el('p_method').value = 'card';
      el('p_kind').value = 'payment';
      el('p_note').value = '';
      const today = LianaJalali.todayISO();
      el('p_date').value = today;
      el('p_date_display').value = LianaJalali.isoToJalaliDisplay(today);
    }
  }

  function onProductChange() {
    const v = el('t_product').value;
    const noProduct = v === NO_PRODUCT || !v;
    el('t_lot_field').style.display = noProduct ? 'none' : '';
    el('t_name_field').style.display = noProduct ? '' : 'none';
    const lotSel = el('t_lot');
    lotSel.innerHTML = '';
    if (noProduct) { el('t_unit').textContent = ''; return; }
    const p = DATA.products.find((x) => String(x.id) === v);
    el('t_unit').textContent = p ? `(${p.unit})` : '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = p && p.lots.length ? 'خودکار (زودانقضاترین سری)' : 'سری‌ای تو انبار ثبت نشده';
    lotSel.appendChild(auto);
    (p?.lots || []).forEach((l) => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = `${l.lot_number || 'بدونِ شماره'}، ${l.expiry_date ? 'انقضا ' + LianaJalali.isoToJalaliDisplay(l.expiry_date) : 'بدونِ انقضا'}، ${fmtQty(l.quantity_remaining)} مونده`;
      lotSel.appendChild(o);
    });
  }

  async function addTreatment(deduct) {
    const v = el('t_product').value;
    const noProduct = v === NO_PRODUCT || !v;
    const qtyRaw = el('t_qty').value.trim();
    const qty = qtyRaw ? parseAmount(qtyRaw) : null;
    if (qtyRaw && Number.isNaN(qty)) { toast('مقدار باید عدد باشه', true); return; }
    const payload = { area: el('t_area').value.trim(), deduct };
    if (noProduct) {
      payload.product_name = el('t_name').value.trim();
      if (!payload.product_name) { toast('بنویس چه کاری انجام شد (مثلاً RF صورت)', true); return; }
      payload.quantity = qty;
    } else {
      if (!qty || qty <= 0) { toast('مقدارِ مصرف‌شده رو بنویس', true); return; }
      payload.product_id = Number(v);
      payload.quantity = qty;
      if (el('t_lot').value) payload.lot_id = Number(el('t_lot').value);
    }
    try {
      const d = await apiPost(`/admin/bookings/${BOOKING_ID}/treatments`, payload);
      render(d, false);
      el('t_qty').value = ''; el('t_area').value = ''; el('t_name').value = '';
      toast('ثبت شد');
    } catch (e) {
      if (e.code === 'insufficient_stock' && deduct) {
        if (confirm(`${e.message}\n\nدرمان انجام شده و باید ثبت بشه. بدونِ کم‌کردن از انبار ثبتش کنم؟ (بعداً موجودی رو از صفحه‌ی انبار اصلاح کن)`)) addTreatment(false);
        return;
      }
      toast(e.message, true);
    }
  }

  async function deleteTreatment(t) {
    const back = t.deducted ? `\n${fmtQty(t.quantity)} ${t.unit} به انبار برمی‌گرده.` : '';
    if (!confirm(`ردیفِ «${t.product_name}» از پرونده حذف بشه؟${back}`)) return;
    try {
      render(await apiDelete(`/admin/bookings/${BOOKING_ID}/treatments/${t.id}`), false);
      toast('حذف شد');
    } catch (e) { toast(e.message, true); }
  }

  async function savePrice() {
    const raw = el('f_price').value.trim();
    const n = raw ? parseAmount(raw) : null;
    if (raw && Number.isNaN(n)) { toast('مبلغ باید عدد باشه', true); return; }
    try {
      await apiPut(`/admin/bookings/${BOOKING_ID}`, { price: n });
      render(await apiGet(`/admin/bookings/${BOOKING_ID}/file`), false);
      toast('مبلغِ نوبت ذخیره شد');
    } catch (e) { toast(e.message, true); }
  }

  async function addPayment() {
    const amount = parseAmount(el('p_amount').value);
    if (!amount || Number.isNaN(amount) || amount <= 0) { toast('مبلغِ پرداخت رو بنویس', true); return; }
    try {
      const d = await apiPost(`/admin/bookings/${BOOKING_ID}/payments`, {
        amount, method: el('p_method').value, kind: el('p_kind').value,
        paid_at: el('p_date').value, note: el('p_note').value.trim(),
      });
      render(d, true);
      toast('پرداخت ثبت شد');
    } catch (e) { toast(e.message, true); }
  }

  async function deletePayment(p) {
    if (!confirm(`پرداختِ ${money(p.amount)} تومان (${LianaJalali.isoToJalaliDisplay(p.paid_at)}) حذف بشه؟`)) return;
    try {
      render(await apiDelete(`/admin/bookings/${BOOKING_ID}/payments/${p.id}`), false);
      toast('حذف شد');
    } catch (e) { toast(e.message, true); }
  }

  return { open };
})();
