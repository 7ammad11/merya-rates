/**
 * Merya Hotels — rates pages
 * Turns rates.json into GitHub Pages (docs/) that the Respond.io AI agent
 * reads as website knowledge sources:
 *   docs/shafa.html, docs/zahra.html — one page per branch, one section per night
 *   docs/index.html                  — short overview linking both
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

const ORDER = ['shafa', 'zahra'];

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// ───────────────────────────── helpers ─────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sar(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '') + ' ريال';
}

// '2026-12-02' -> 'الأربعاء 2 ديسمبر 2026'
function dayAr(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function riyadh(iso) {
  // guests are in Saudi Arabia (UTC+3, no DST)
  return new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString();
}

function shell(title, desc, body) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;max-width:860px;margin:0 auto;padding:16px;line-height:1.7;color:#1d1d1f;background:#fff}
h2{margin-top:28px;border-top:1px solid #eee;padding-top:16px;font-size:1.15em}
a{word-break:break-all}
.note{background:#fff8e1;border:1px solid #f0d58c;padding:10px 14px;border-radius:6px}
</style>
</head>
<body>
${body}</body>
</html>
`;
}

// ───────────────────────────── pages ─────────────────────────────

function header(data) {
  const now = riyadh(data.generated_at);
  return '<p><strong>تاريخ اليوم:</strong> ' + dayAr(now.slice(0, 10)) + ' (' + now.slice(0, 10) + ').' +
    ' آخر تحديث للأسعار: ' + now.slice(11, 16) + ' بتوقيت السعودية، من محرك الحجز الرسمي لفنادق ميريا. تُحدَّث يوميًا.</p>\n';
}

function rules(name) {
  return '<div class="note">\n<p><strong>تعليمات استخدام أسعار ' + esc(name) + ':</strong></p>\n<ul>\n' +
    '<li>اسأل العميل عن تاريخ الدخول والخروج قبل ذكر أي سعر، وأكّد معه التاريخ الكامل.</li>\n' +
    '<li>كل قسم أدناه هو سعر ليلة واحدة بتاريخها. للإقامة عدة ليالٍ اجمع أسعار لياليها.</li>\n' +
    '<li>الأسعار بالريال السعودي وشاملة الضريبة، كما يعرضها محرك الحجز اليوم.</li>\n' +
    '<li>لا تؤكد توفّر أي غرفة؛ التوفّر يتغيّر خلال ساعات. أرفق رابط الحجز المباشر دائمًا.</li>\n' +
    '<li>إن لم يوجد قسم للتاريخ المطلوب أو لم تظهر فيه أسعار فلا تخمّن: أرسل رابط الحجز وحوّل للمختص.</li>\n' +
    '</ul>\n</div>\n';
}

function branchPage(code, b, data) {
  const name = b.hotel_ar || NAMES[code] || code;
  const link = BOOKING[code];
  const windows = (b.windows || []).filter(w => w.nights === 1);
  const first = windows.length ? windows[0].checkin : '';
  const last = windows.length ? windows[windows.length - 1].checkin : '';

  let h = '<h1>أسعار الليلة في ' + esc(name) + ' حسب التاريخ</h1>\n' + header(data) +
    '<p>تغطي هذه الصفحة كل ليلة من ' + esc(first) + ' إلى ' + esc(last) + '.</p>\n' +
    '<p>رابط الحجز المباشر لـ ' + esc(name) + ': <a href="' + esc(link) + '">' + esc(link) + '</a></p>\n' +
    rules(name);

  for (const w of windows) {
    // every section repeats branch + date so each chunk stands on its own
    h += '<h2>' + esc(name) + ' — ليلة ' + dayAr(w.checkin) + ' (' + esc(w.checkin) + ')</h2>\n';
    if (w.status !== 'ok' || !w.rooms || !w.rooms.length) {
      h += '<p>لا تظهر أسعار في ' + esc(name) + ' لليلة ' + esc(w.checkin) +
        ' (الدخول ' + esc(w.checkin) + ' والخروج ' + esc(w.checkout) + '). لا تخمّن سعرًا: أرسل رابط الحجز وحوّل للمختص.</p>\n';
      continue;
    }
    h += '<p>سعر ليلة ' + dayAr(w.checkin) + ' في ' + esc(name) + ' (الدخول ' + esc(w.checkin) +
      ' والخروج ' + esc(w.checkout) + ') حسب محرك الحجز اليوم، شامل الضريبة:</p>\n<ul>\n';
    for (const r of [...w.rooms].sort((a, z) => a.per_night - z.per_night)) {
      h += '<li>' + esc(r.room) + ' (' + esc(r.name_page || r.code) + '): ' + sar(r.per_night) + '</li>\n';
    }
    h += '</ul>\n';
  }

  return shell('أسعار ' + name + ' لكل ليلة',
    'سعر الليلة في ' + name + ' لكل تاريخ خلال الأيام القادمة، من محرك الحجز الرسمي، شامل الضريبة ومحدّث يوميًا.', h);
}

function indexPage(codes, branches, data) {
  let h = '<h1>أسعار غرف فنادق ميريا</h1>\n' + header(data) +
    '<p>أسعار كل ليلة لكل فرع في صفحة مستقلة:</p>\n<ul>\n';
  for (const c of codes) {
    const name = branches[c].hotel_ar || NAMES[c] || c;
    h += '<li><a href="' + c + '.html">' + esc(name) + '</a></li>\n';
  }
  return shell('أسعار غرف فنادق ميريا', 'فهرس صفحات أسعار فنادق ميريا اليومية.', h + '</ul>\n');
}

// ───────────────────────────── main ─────────────────────────────

const data = JSON.parse(fs.readFileSync('rates.json', 'utf8'));
const branches = data.branches || {};
const codes = ORDER.filter(c => branches[c]).concat(Object.keys(branches).filter(c => ORDER.indexOf(c) < 0));

fs.mkdirSync('docs', { recursive: true });
for (const c of codes) fs.writeFileSync('docs/' + c + '.html', branchPage(c, branches[c], data));
fs.writeFileSync('docs/index.html', indexPage(codes, branches, data));
fs.writeFileSync('docs/.nojekyll', '');
console.log('docs written: index, ' + codes.join(', '));
