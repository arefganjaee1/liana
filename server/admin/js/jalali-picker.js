// پیکرِ پاپ‌آپِ تقویمِ شمسیِ اختصاصی — چون <input type="date"> مرورگرها اصلاً از تقویمِ شمسی پشتیبانی نمی‌کنن.
// رویِ LianaJalali (jalali.js) سوار می‌شه، بدونِ هیچ کتابخانه‌ی بیرونی.
// attach(displayInput, hiddenInput): displayInput یه اینپوتِ متنیِ readonly که با کلیک باز می‌شه و متنِ شمسی نشون می‌ده؛
// hiddenInput مقدارِ واقعیِ میلادیِ 'YYYY-MM-DD' رو نگه می‌داره (همون چیزی که فرم/سرور می‌خواد).
(function (global) {
  function attach(displayInput, hiddenInput) {
    const wrap = displayInput.closest('.jpicker') || displayInput.parentElement;
    let popup = null;
    let viewJy, viewJm;

    function parseHidden() {
      if (!hiddenInput.value) return null;
      const p = hiddenInput.value.split('-').map(Number);
      return LianaJalali.toJalali(p[0], p[1], p[2]);
    }

    function fireChange() {
      hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function selectDay(jy, jm, jd) {
      const iso = LianaJalali.jalaliToISO(jy, jm, jd);
      hiddenInput.value = iso;
      displayInput.value = LianaJalali.isoToJalaliDisplay(iso);
      fireChange();
      close();
    }

    function clearValue() {
      hiddenInput.value = '';
      displayInput.value = '';
      fireChange();
      close();
    }

    function shiftMonth(delta) {
      viewJm += delta;
      if (viewJm > 12) { viewJm = 1; viewJy += 1; }
      if (viewJm < 1) { viewJm = 12; viewJy -= 1; }
      render();
    }

    function render() {
      const today = LianaJalali.todayJalali();
      const selected = parseHidden();
      const daysCount = LianaJalali.daysInMonth(viewJy, viewJm);
      const startCol = LianaJalali.firstWeekdayIndex(viewJy, viewJm);

      let yearOptions = '';
      for (let y = today.jy + 5; y >= today.jy - 90; y -= 1) {
        yearOptions += `<option value="${y}"${y === viewJy ? ' selected' : ''}>${LianaJalali.faDigits(y)}</option>`;
      }
      const monthOptions = LianaJalali.MONTH_NAMES.map((name, i) =>
        `<option value="${i + 1}"${i + 1 === viewJm ? ' selected' : ''}>${name}</option>`
      ).join('');
      const weekdaysHtml = LianaJalali.WEEKDAY_SHORT.map((w) => `<span>${w}</span>`).join('');

      let dayCells = '';
      for (let i = 0; i < startCol; i += 1) dayCells += '<button type="button" class="jpicker-day is-empty" tabindex="-1"></button>';
      for (let d = 1; d <= daysCount; d += 1) {
        const isToday = today.jy === viewJy && today.jm === viewJm && today.jd === d;
        const isSelected = !!selected && selected.jy === viewJy && selected.jm === viewJm && selected.jd === d;
        dayCells += `<button type="button" class="jpicker-day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}" data-d="${d}">${LianaJalali.faDigits(d)}</button>`;
      }

      popup.innerHTML = `
        <div class="jpicker-head">
          <button type="button" class="jpicker-nav" data-nav="prev" aria-label="ماهِ قبل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
          <select class="jp-month">${monthOptions}</select>
          <select class="jp-year">${yearOptions}</select>
          <button type="button" class="jpicker-nav" data-nav="next" aria-label="ماهِ بعد"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
        <div class="jpicker-weekdays">${weekdaysHtml}</div>
        <div class="jpicker-days">${dayCells}</div>
        <div class="jpicker-footer">
          <button type="button" data-action="today">امروز</button>
          <button type="button" data-action="clear">پاک‌کردن</button>
        </div>
      `;

      popup.querySelector('[data-nav="prev"]').addEventListener('click', () => shiftMonth(-1));
      popup.querySelector('[data-nav="next"]').addEventListener('click', () => shiftMonth(1));
      popup.querySelector('.jp-month').addEventListener('change', (e) => { viewJm = Number(e.target.value); render(); });
      popup.querySelector('.jp-year').addEventListener('change', (e) => { viewJy = Number(e.target.value); render(); });
      popup.querySelectorAll('.jpicker-day:not(.is-empty)').forEach((btn) => {
        btn.addEventListener('click', () => selectDay(viewJy, viewJm, Number(btn.dataset.d)));
      });
      popup.querySelector('[data-action="today"]').addEventListener('click', () => {
        const t = LianaJalali.todayJalali();
        selectDay(t.jy, t.jm, t.jd);
      });
      popup.querySelector('[data-action="clear"]').addEventListener('click', clearValue);
    }

    function onOutside(e) {
      if (popup && !popup.contains(e.target) && e.target !== displayInput) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    function open() {
      if (popup) return;
      const cur = parseHidden() || LianaJalali.todayJalali();
      viewJy = cur.jy;
      viewJm = cur.jm;
      popup = document.createElement('div');
      popup.className = 'jpicker-popup';
      wrap.appendChild(popup);
      render();
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }

    function close() {
      if (!popup) return;
      popup.remove();
      popup = null;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    }

    displayInput.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popup) close(); else open();
    });

    // مقدارِ اولیه (اگه از قبل ست شده — مثلاً موقعِ بازکردنِ فرمِ ویرایش)
    if (hiddenInput.value) {
      displayInput.value = LianaJalali.isoToJalaliDisplay(hiddenInput.value);
    }
  }

  global.LianaJalaliPicker = { attach: attach };
})(window);
