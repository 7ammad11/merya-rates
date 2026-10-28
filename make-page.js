/**
 * Merya Hotels — rates page
 * Turns rates.json into docs/index.html (served by GitHub Pages) so the
 * Respond.io AI agent can read it as a website knowledge source.
 *
 * Plain HTML, no scripts: the crawler only reads server-rendered text.
 * rooms_left is left out on purpose — the agent must never confirm availability.
 */

const fs = require('fs');

const BOOKING = {
  shafa: 'https://booking.staygrid.com/webv2/index/index/key/b696d2839749ffca687ee4e768bafd0e17639661206923fca8033e6____WUFYNWVaRGhMbTNpYmhzSUlLLzE4ZzU3KzRXaDN5VDQ2WGtLL0NNMDFUcyswRVhwQ3NnSmtUZk5xbU5ZYnpvZE9PTGk1Y0NUTE8yc1V3K2Z4Sy9iTVQzWGRoLzd5dlVpeVMzOStCeWxCUlNETUd0a3duaE5HdEpWaDdHZXVBNC8%257C',
  zahra: 'https://booking.staygrid.com/webv2/index/index/key/beb25861a362c1574702f07eca5b8ce7175758376068c2999064345____VEwvOVN1LzV2Y2xKU0lEM0hBK1kxdkxHUThoNGtvQUlkQVVIOXlLUWFWbWxYTHBTTW5UaWxJUEUwcUdrZ3E5Ymhvbkg0U2FsNWVrV1MwZmVhT0V4SDhReDJCaTdXSzU1cDVkVk1sSXN2Y2wweEw1OXRVV2dvYk5Rd0s0a04wd2Y%257C'
};

const NAMES = { shafa: 'ميريا الشفا', zahra: 'ميريا الزهراء' };

// ───────────────────────────── helpers ─────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sar(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '') + ' ريال';
}

function nightsAr(n) {
  return n === 1 ? 'ليلة واحدة' : n === 2 ? 'ليلتان' : n + ' ليالٍ';
}

function riyadhTime(iso) {
  // Respond.io guests are in Saudi Arabia (UTC+3, no DST)
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' بتوقيت السعودية';
}

// ───────────────────────────── sections ─────────────────────────────

function branchSection(code, b) {
  const name = b.hotel_ar || NAMES[code] || code;
  const link = BOOKING[code];
  const windows = b.windows || [];
  const ok = windows.filter(w => w.status === 'ok' && w.cheapest);

  let h = '<section id="' + esc(code) + '">\n<h2>' + esc(name) + '</h2>\n';

  if (ok.length) {
    const min = Math.min(...ok.map(w => w.cheapest.per_night));
    const max = Math.max(...ok.map(w => w.cheapest.per_night));
    h += '<p><strong>ملخص:</strong> سعر الليلة في ' + esc(name) + ' يبدأ من ' + sar(min) +
      ' شامل الضريبة (السعر تقديري ويتغيّر حسب التاريخ' +
      (max > min ? '، وأقل سعر في الفترات المسحوبة بين ' + sar(min) + ' و' + sar(max) : '') + ').</p>\n';
  } else {
    h += '<p><strong>ملخص:</strong> لا توجد أسعار حالية لـ ' + esc(name) +
      ' في الفترات المسحوبة. يُوجَّه العميل إلى رابط الحجز ليرى السعر الفعلي.</p>\n';
  }
  h += '<p>رابط الحجز المباشر لـ ' + esc(name) + ': <a href="' + esc(link) + '">' + esc(link) + '</a></p>\n';

  for (const w of windows) {
    h += '<h3>' + esc(name) + ' — وصول ' + esc(w.checkin) + '، مغادرة ' + esc(w.checkout) +
      ' (' + nightsAr(w.nights) + ')</h3>\n';
    if (w.status !== 'ok' || !w.rooms || !w.rooms.length) {
      h += '<p>لا توجد أسعار معروضة لهذه الفترة. يُحال العميل إلى رابط الحجز.</p>\n';
      continue;
    }
    h += '<p>أقل سعر لليلة: ' + sar(w.cheapest.per_night) + ' (' + esc(w.cheapest.room) + ') شامل الضريبة.</p>\n';
    h += '<table>\n<thead><tr><th>نوع الوحدة</th><th>Room type</th><th>سعر الليلة</th><th>إجمالي الإقامة</th></tr></thead>\n<tbody>\n';
    for (const r of [...w.rooms].sort((a, z) => a.per_night - z.per_night)) {
      h += '<tr><td>' + esc(r.room) + '</td><td>' + esc(r.name_page || r.code) + '</td><td>' +
        sar(r.per_night) + '</td><td>' + sar(r.total) + '</td></tr>\n';
    }
    h += '</tbody>\n</table>\n';
  }
  return h + '</section>\n';
}

// ───────────────────────────── main ─────────────────────────────

const data = JSON.parse(fs.readFileSync('rates.json', 'utf8'));
const branches = data.branches || {};

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>أسعار غرف فنادق ميريا — الشفا والزهراء</title>
<meta name="description" content="أسعار الليلة التقديرية لفندقي ميريا الشفا وميريا الزهراء في الطائف، محدثة يوميًا وشاملة الضريبة.">
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;max-width:860px;margin:0 auto;padding:16px;line-height:1.7;color:#1d1d1f;background:#fff}
table{border-collapse:collapse;width:100%;margin:8px 0 20px}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:right}
th{background:#f5f5f7}
a{word-break:break-all}
.note{background:#fff8e1;border:1px solid #f0d58c;padding:10px 14px;border-radius:6px}
</style>
</head>
<body>
<h1>أسعار غرف فنادق ميريا (الشفا والزهراء)</h1>
<p>آخر تحديث: ${esc(riyadhTime(data.generated_at))}. المصدر: محرك الحجز الرسمي لفنادق ميريا.</p>
<div class="note">
<p><strong>تعليمات استخدام هذه الأسعار:</strong></p>
<ul>
<li>جميع الأسعار بالريال السعودي، تقديرية، وشاملة الضريبة.</li>
<li>عند السؤال عن السعر: اذكر «يبدأ من X ريال لليلة شامل الضريبة» بأقل سعر للفرع المطلوب.</li>
<li>لا تؤكد توفّر أي غرفة أو عدد الغرف المتبقية؛ التوفّر يتغيّر خلال ساعات.</li>
<li>أرفق رابط الحجز المباشر للفرع دائمًا ليرى العميل السعر والتوفّر الفعليين.</li>
<li>بعد إعطاء السعر أكمل التأهيل (الفندق، التواريخ، نوع الوحدة، عدد الضيوف) ثم حوّل للمختص.</li>
</ul>
</div>
${Object.keys(branches).map(c => branchSection(c, branches[c])).join('\n')}
</body>
</html>
`;

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', html);
fs.writeFileSync('docs/.nojekyll', '');
console.log('docs/index.html written (' + Object.keys(branches).join(', ') + ')');
