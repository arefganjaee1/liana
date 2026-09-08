// تبدیلِ میلادی↔شمسی برایِ پنل — الگوریتمِ استانداردِ جلالی، بدونِ هیچ کتابخانه‌ی بیرونی.
// تستِ صحتِ این الگوریتم (چندین تاریخِ مرجع، شاملِ سال‌های کبیسه) قبلِ استفاده انجام شد.
(function (global) {
  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCalBreaks(jy) {
    var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = breaks.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = breaks[0];
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سالِ جلالیِ نامعتبر ' + jy);
    var jump = 0;
    var i;
    for (i = 1; i < bl; i += 1) {
      var jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    var n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    var march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    var leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5)
      + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCalBreaks(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCalBreaks(jy);
    var jdn1f = g2d(gy, 3, r.march);
    var k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }

  function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
  function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }

  var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faDigits(s) { return String(s).replace(/[0-9]/g, function (c) { return FA_DIGITS[+c]; }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // شنبه...جمعه — بر پایه‌ی باقیمانده‌ی شماره‌ی روزِ ژولینی (نه Date جاوااسکریپت، تا وابسته‌ی تایم‌زونِ مرورگر نباشه)
  var WEEKDAY_BY_MOD = ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'];
  function weekdayFromISO(iso) {
    var p = iso.split('-').map(Number);
    var jdn = g2d(p[0], p[1], p[2]);
    return WEEKDAY_BY_MOD[mod(jdn, 7)];
  }

  // 'YYYY-MM-DD' میلادی → '۱۴۰۵/۰۶/۱۷' (با گزینه‌ی نمایشِ نامِ روزِ هفته)
  function isoToJalaliDisplay(iso, withWeekday) {
    if (!iso) return '—';
    var p = iso.split('-').map(Number);
    var j = toJalali(p[0], p[1], p[2]);
    var out = faDigits(j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd));
    return withWeekday ? (weekdayFromISO(iso) + '، ' + out) : out;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  global.LianaJalali = {
    toJalali: toJalali,
    toGregorian: toGregorian,
    faDigits: faDigits,
    weekdayFromISO: weekdayFromISO,
    isoToJalaliDisplay: isoToJalaliDisplay,
    todayISO: todayISO,
  };
})(window);
