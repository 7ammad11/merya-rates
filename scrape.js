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
  TBSSC: 'جناح غرفتين سوبيريور مع إطلالة على المدينة',

  // Al Shafa — the names the Respond.io agent's instructions use,
  // confirmed by the owner 2026-10-28 (JVILA is the two-storey villa)
  SUT:    'جناح من غرفة نوم وصالة',
  SUTWVB: 'جناح من غرفة نوم وصالة مع بلكونة وإطلالة',
  JVILA:  'فيلا دورين مع بلكونة وإطلالة',
  SUTWT:  'جناح من غرفة نوم وصالة مع تراس',
  TBS:    'جناح من غرفتين نوم وصالة',
  TBSVB:  'جناح من غرفتين نوم وصالة مع بلكونة وإطلالة',
  HANDI:  'جناح من غرفتين نوم وصالة مع بلكونة وإطلالة لذوي الاحتياجات الخاصة'
};

// windows to price each run: every single night from tomorrow out to
// DAYS_AHEAD, so the agent can quote the exact night a guest asks about
// DAYS_AHEAD env (workflow input) allows a short test run
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD, 10) || 60;
const WINDOWS = Array.from({ length: DAYS_AHEAD }, (_, i) => ({ in: i + 1, nights: 1 }));

// one search at a time: parallel searches made the engine return empty room
// lists (and an F5 503) for nights that do have rooms — tested 2026-10-28
const WORKERS = 1;

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

  // the engine lands on /selectroom/ and may then redirect itself to
  // /filterHotel/; checking for rooms mid-redirect finds none
  await page.waitForURL(/\/selectroom\//, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForSelector('[roomseq]', { timeout: 25000 }).catch(() => {});

  // some properties only render the room list behind an explicit hotel filter
  if (!(await page.$('[roomseq]'))) {
    const u = page.url();
    if (u.indexOf('/selectroom/') >= 0 && u.indexOf('filterHotel') < 0) {
      await page.goto(u.replace(/\/$/, '') + '/filterHotel/' + b.hotelId,
        { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      await page.waitForSelector('[roomseq]', { timeout: 20000 }).catch(() => {});
    }
  }

  if (!(await page.$('[roomseq]'))) {
    // screenshots only for empty results — 120 full-page shots per run is too many
    await page.screenshot({ path: 'shot-' + shotTag + '.png', fullPage: true }).catch(() => {});
    const txt = await page.evaluate(() =>
      document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
    return { rooms: [], note: 'no_rooms', url: page.url().slice(0, 120), page_text: txt };
  }

  const raw = await page.evaluate(() => {
    // the room type's display name, taken from the page itself so new
    // room types never need a code added to ROOM_NAMES by hand
    // the room type sits in the "Accommodation Type" column as a link in an
    // ancestor of the rate block (the block's own h4 is the RATE PLAN name,
    // e.g. "Room Only" — not what we want)
    function pickName(blk) {
      let p = blk;
      for (let lvl = 0; lvl < 6 && p; lvl++) {
        p = p.parentElement;
        if (!p) break;
        for (const a of p.querySelectorAll('a')) {
          const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length < 3 || t.length > 60) continue;
          if (/^[\d.,\s]+$/.test(t)) continue;
          if (/^(SAR|SR)\b/i.test(t)) continue;
          if (/view all|book\s*now|select|reserve|login|sign/i.test(t)) continue;
          return t;
        }
      }
      return null;
    }

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
        name_page: pickName(blk),
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
      // verified Arabic name wins; otherwise whatever the engine displays
      room: ROOM_NAMES[code] || r.name_page || code,
      name_page: r.name_page || null,
      total: round2(r.total),
      per_night: round2(r.total / nights),
      rooms_left: r.rooms_left
    };
    if (!best[code] || row.total < best[code].total) best[code] = row;
  }

  const rooms = Object.values(best).sort((a, b) => a.total - b.total);
  return { rooms, note: rooms.length ? 'ok' : 'no_rooms', url: page.url().slice(0, 120) };
}

async function priceWindow(page, b, code, w) {
  const checkin = ymd(addDays(w.in));
  const checkout = ymd(addDays(w.in + w.nights));
  let r = await searchWindow(page, b, checkin, checkout, code + '-' + w.in);
  // an empty list is sometimes a timing miss, not a sold-out night: search again
  if (r.note !== 'ok') r = await searchWindow(page, b, checkin, checkout, code + '-' + w.in);
  return {
    checkin, checkout, nights: w.nights,
    status: r.note,
    cheapest: r.rooms[0] || null,
    rooms: r.rooms,
    debug: r.note === 'ok' ? undefined : { url: r.url, page_text: r.page_text }
  };
}

async function scrapeBranch(browser, code) {
  const b = BRANCHES[code];
  const windows = new Array(WINDOWS.length);
  let next = 0;

  // each worker keeps one page for all its nights (a warm session, as the
  // original 3-window scraper did); a fresh context per night came back empty
  async function worker() {
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
    let page = await ctx.newPage();
    try {
      while (next < WINDOWS.length) {
        const i = next++;
        try {
          windows[i] = await priceWindow(page, b, code, WINDOWS[i]);
        } catch (e) {
          // one retry on a fresh session
          await ctx.close();
          ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
          page = await ctx.newPage();
          try {
            windows[i] = await priceWindow(page, b, code, WINDOWS[i]);
          } catch (e2) {
            const w = WINDOWS[i];
            windows[i] = { checkin: ymd(addDays(w.in)), checkout: ymd(addDays(w.in + w.nights)), nights: w.nights,
              status: 'error', error: String(e2).slice(0, 200), rooms: [] };
          }
        }
      }
    } finally {
      await ctx.close();
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));

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
  TBSSC: 'جناح غرفتين سوبيريور مع إطلالة على المدينة',

  // Al Shafa — the names the Respond.io agent's instructions use,
  // confirmed by the owner 2026-10-28 (JVILA is the two-storey villa)
  SUT:    'جناح من غرفة نوم وصالة',
  SUTWVB: 'جناح من غرفة نوم وصالة مع بلكونة وإطلالة',
  JVILA:  'فيلا دورين مع بلكونة وإطلالة',
  SUTWT:  'جناح من غرفة نوم وصالة مع تراس',
  TBS:    'جناح من غرفتين نوم وصالة',
  TBSVB:  'جناح من غرفتين نوم وصالة مع بلكونة وإطلالة',
  HANDI:  'جناح من غرفتين نوم وصالة مع بلكونة وإطلالة لذوي الاحتياجات الخاصة'
};

// windows to price each run: every single night from tomorrow out to
// DAYS_AHEAD, so the agent can quote the exact night a guest asks about
// DAYS_AHEAD env (workflow input) allows a short test run
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD, 10) || 60;
const WINDOWS = Array.from({ length: DAYS_AHEAD }, (_, i) => ({ in: i + 1, nights: 1 }));

// one search at a time: parallel searches made the engine return empty room
// lists (and an F5 503) for nights that do have rooms — tested 2026-10-28
const WORKERS = 1;

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
  // the room list renders after the network goes quiet on a cold session
  await page.waitForSelector('[roomseq]', { timeout: 20000 }).catch(() => {});

  // some properties only render the room list behind an explicit hotel filter
  if (!(await page.$('[roomseq]'))) {
    const u = page.url();
    if (u.indexOf('/selectroom/') >= 0 && u.indexOf('filterHotel') < 0) {
      await page.goto(u.replace(/\/$/, '') + '/filterHotel/' + b.hotelId,
        { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      await page.waitForSelector('[roomseq]', { timeout: 20000 }).catch(() => {});
    }
  }

  if (!(await page.$('[roomseq]'))) {
    // screenshots only for empty results — 120 full-page shots per run is too many
    await page.screenshot({ path: 'shot-' + shotTag + '.png', fullPage: true }).catch(() => {});
    const txt = await page.evaluate(() =>
      document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
    return { rooms: [], note: 'no_rooms', url: page.url().slice(0, 120), page_text: txt };
  }

  const raw = await page.evaluate(() => {
    // the room type's display name, taken from the page itself so new
    // room types never need a code added to ROOM_NAMES by hand
    // the room type sits in the "Accommodation Type" column as a link in an
    // ancestor of the rate block (the block's own h4 is the RATE PLAN name,
    // e.g. "Room Only" — not what we want)
    function pickName(blk) {
      let p = blk;
      for (let lvl = 0; lvl < 6 && p; lvl++) {
        p = p.parentElement;
        if (!p) break;
        for (const a of p.querySelectorAll('a')) {
          const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length < 3 || t.length > 60) continue;
          if (/^[\d.,\s]+$/.test(t)) continue;
          if (/^(SAR|SR)\b/i.test(t)) continue;
          if (/view all|book\s*now|select|reserve|login|sign/i.test(t)) continue;
          return t;
        }
      }
      return null;
    }

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
        name_page: pickName(blk),
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
      // verified Arabic name wins; otherwise whatever the engine displays
      room: ROOM_NAMES[code] || r.name_page || code,
      name_page: r.name_page || null,
      total: round2(r.total),
      per_night: round2(r.total / nights),
      rooms_left: r.rooms_left
    };
    if (!best[code] || row.total < best[code].total) best[code] = row;
  }

  const rooms = Object.values(best).sort((a, b) => a.total - b.total);
  return { rooms, note: rooms.length ? 'ok' : 'no_rooms', url: page.url().slice(0, 120) };
}

async function priceWindow(page, b, code, w) {
  const checkin = ymd(addDays(w.in));
  const checkout = ymd(addDays(w.in + w.nights));
  const r = await searchWindow(page, b, checkin, checkout, code + '-' + w.in);
  return {
    checkin, checkout, nights: w.nights,
    status: r.note,
    cheapest: r.rooms[0] || null,
    rooms: r.rooms,
    debug: r.note === 'ok' ? undefined : { url: r.url, page_text: r.page_text }
  };
}

async function scrapeBranch(browser, code) {
  const b = BRANCHES[code];
  const windows = new Array(WINDOWS.length);
  let next = 0;

  // each worker keeps one page for all its nights (a warm session, as the
  // original 3-window scraper did); a fresh context per night came back empty
  async function worker() {
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
    let page = await ctx.newPage();
    try {
      while (next < WINDOWS.length) {
        const i = next++;
        try {
          windows[i] = await priceWindow(page, b, code, WINDOWS[i]);
        } catch (e) {
          // one retry on a fresh session
          await ctx.close();
          ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
          page = await ctx.newPage();
          try {
            windows[i] = await priceWindow(page, b, code, WINDOWS[i]);
          } catch (e2) {
            const w = WINDOWS[i];
            windows[i] = { checkin: ymd(addDays(w.in)), checkout: ymd(addDays(w.in + w.nights)), nights: w.nights,
              status: 'error', error: String(e2).slice(0, 200), rooms: [] };
          }
        }
      }
    } finally {
      await ctx.close();
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));

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
