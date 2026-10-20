/**
 * Merya Hotels — rate & availability scraper
 * Hotelogix Web Booking Engine (booking.staygrid.com)
 *
 * Runs in GitHub Actions with Playwright (a real browser is required:
 * the engine mints a new session key per request and bounces plain
 * HTTP clients back to the search page).
 *
 * Output: rates.json  (committed back to the repo by the workflow)
 */

const { chromium } = require('playwright');
const fs = require('fs');

// ───────────────────────────── config ─────────────────────────────

const BASE = 'https://booking.staygrid.com/webv2/index/index/key/';

const BRANCHES = {
  shafa: {
    name: 'Merya Al Shafa',
    name_ar: 'ميريا الشفا',
    hotelId: 87384,
    key: 'b696d2839749ffca687ee4e768bafd0e17639661206923fca8033e6____WUFYNWVaRGhMbTNpYmhzSUlLLzE4ZzU3KzRXaDN5VDQ2WGtLL0NNMDFUcyswRVhwQ3NnSmtUZk5xbU5ZYnpvZE9PTGk1Y0NUTE8yc1V3K2Z4Sy9iTVQzWGRoLzd5dlVpeVMzOStCeWxCUlNETUd0a3duaE5HdEpWaDdHZXVBNC8%257C'
  },
  zahra: {
    name: 'Merya Al Zahra',
    name_ar: 'ميريا الزهراء',
    hotelId: 77010,
    key: 'beb25861a362c1574702f07eca5b8ce7175758376068c2999064345____VEwvOVN1LzV2Y2xKU0lEM0hBK1kxdkxHUThoNGtvQUlkQVVIOXlLUWFWbWxYTHBTTW5UaWxJUEUwcUdrZ3E5Ymhvbkg0U2FsNWVrV1MwZmVhT0V4SDhReDJCaTdXSzU1cDVkVk1sSXN2Y2wweEw1OXRVV2dvYk5Rd0s0a04wd2Y%257C'
  }
};

// roomseq (base64) decodes to these codes
const ROOM_NAMES = {
  STD:   'ستوديو',
  OBA:   'جناح',
  OBACV: 'جناح غرفة نوم مع إطلالة على المدينة',
  TBA:   'جناح غرفتين',
  TBSS:  'جناح غرفتين سوبيريور',
  TBACV: 'جناح غرفتين مع إطلالة على المدينة',
  TBSSC: 'جناح غرفتين سوبيريور مع إطلالة على المدينة'
};

// windows to price each run: { in: days from today, nights: n }
const WINDOWS = [
  { in: 1,  nights: 1 },
  { in: 7,  nights: 2 },
  { in: 21, nights: 2 }
];

// ───────────────────────────── helpers ─────────────────────────────

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function decodeSeq(s) {
  try {
    const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(t + '==='.slice((t.length + 3) % 4), 'base64').toString('utf8');
  } catch (e) {
    return String(s);
  }
}

function round2(n) { return Math.round(n * 100) / 100; }

// ───────────────────────────── scrape ─────────────────────────────

async function searchWindow(page, b, checkin, checkout, shotTag) {
  await page.goto(BASE + b.key, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.evaluate(([ci, co]) => {
    const f = Array.from(document.forms).find(x => x.elements['checkInMysql']);
    if (!f) throw new Error('search_form_not_found');
    f.elements['checkInMysql'].value = ci;
    f.elements['checkOutMysql'].value = co;
    f.submit();
  }, [checkin, checkout]);

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  // some properties only render the room list behind an explicit hotel filter
  if (!(await page.$('[roomseq]'))) {
    const u = page.url();
    if (u.indexOf('/selectroom/') >= 0 && u.indexOf('filterHotel') < 0) {
      await page.goto(u.replace(/\/$/, '') + '/filterHotel/' + b.hotelId,
        { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    }
  }

  await page.screenshot({ path: 'shot-' + shotTag + '.png', fullPage: true }).catch(() => {});

  if (!(await page.$('[roomseq]'))) {
    const txt = await page.evaluate(() =>
      document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
    return { rooms: [], note: 'no_rooms', url: page.url().slice(0, 120), page_text: txt };
  }

  const raw = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.accomodation-rate').forEach(blk => {
      const sq = blk.querySelector('[roomseq]');
      const pr = blk.querySelector('.pax-price.price');
      if (!sq || !pr) return;
      const m = (pr.textContent || '').match(/([\d,]+\.\d{2})/);
      if (!m) return;
      const left = (blk.innerText.match(/(\d+)\s*room\(s\)\s*left/) || [])[1];
      out.push({
        seq: sq.getAttribute('roomseq'),
        total: parseFloat(m[1].replace(/,/g, '')),
        rooms_left: left ? parseInt(left, 10) : null
      });
    });
    return out;
  });

  const nights = Math.round(
    (Date.parse(checkout + 'T00:00:00Z') - Date.parse(checkin + 'T00:00:00Z')) / 86400000);

  // same room type can appear under several rate plans — keep the cheapest
  const best = {};
  for (const r of raw) {
    if (!isFinite(r.total) || r.total <= 0) continue;
    const code = decodeSeq(r.seq);
    const row = {
      code,
      room: ROOM_NAMES[code] || code,
      total: round2(r.total),
      per_night: round2(r.total / nights),
      rooms_left: r.rooms_left
    };
    if (!best[code] || row.total < best[code].total) best[code] = row;
  }

  const rooms = Object.values(best).sort((a, b) => a.total - b.total);
  return { rooms, note: rooms.length ? 'ok' : 'no_rooms', url: page.url().slice(0, 120) };
}

async function scrapeBranch(browser, code) {
  const b = BRANCHES[code];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
  const page = await ctx.newPage();
  const windows = [];

  try {
    for (const w of WINDOWS) {
      const checkin = ymd(addDays(w.in));
      const checkout = ymd(addDays(w.in + w.nights));
      const tag = code + '-' + w.in;
      try {
        const r = await searchWindow(page, b, checkin, checkout, tag);
        windows.push({
          checkin, checkout, nights: w.nights,
          status: r.note,
          cheapest: r.rooms[0] || null,
          rooms: r.rooms,
          debug: r.note === 'ok' ? undefined : { url: r.url, page_text: r.page_text }
        });
      } catch (e) {
        windows.push({ checkin, checkout, nights: w.nights, status: 'error', error: String(e).slice(0, 200), rooms: [] });
      }
    }
  } finally {
    await ctx.close();
  }

  return {
    branch: code,
    hotel: b.name,
    hotel_ar: b.name_ar,
    hotelId: b.hotelId,
    currency: 'SAR',
    tax: 'شامل الضريبة',
    windows
  };
}

// ───────────────────────────── main ─────────────────────────────

(async () => {
  const browser = await chromium.launch();
  const out = {
    generated_at: new Date().toISOString(),
    source: 'Hotelogix Web Booking Engine (booking.staygrid.com)',
    branches: {}
  };

  for (const code of Object.keys(BRANCHES)) {
    try {
      out.branches[code] = await scrapeBranch(browser, code);
    } catch (e) {
      out.branches[code] = { branch: code, status: 'error', error: String(e).slice(0, 300), windows: [] };
    }
  }

  await browser.close();

  // one-line summary for the commit log
  out.summary = Object.keys(out.branches).map(c => {
    const b = out.branches[c];
    const ok = (b.windows || []).filter(w => w.status === 'ok').length;
    const total = (b.windows || []).length;
    return c + ': ' + ok + '/' + total + ' windows ok';
  }).join(' | ');

  fs.writeFileSync('rates.json', JSON.stringify(out, null, 2));
  console.log(out.summary);
})();
