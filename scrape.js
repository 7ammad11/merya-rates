const { chromium } = require('playwright');
const fs = require('fs');

const BRANCHES = {
  shafa: { name: 'Merya Al Shafa', hotelId: 87384, key: 'b696d2839749ffca687ee4e768bafd0e17639661206923fca8033e6____WUFYNWVaRGhMbTNpYmhzSUlLLzE4ZzU3KzRXaDN5VDQ2WGtLL0NNMDFUcyswRVhwQ3NnSmtUZk5xbU5ZYnpvZE9PTGk1Y0NUTE8yc1V3K2Z4Sy9iTVQzWGRoLzd5dlVpeVMzOStCeWxCUlNETUd0a3duaE5HdEpWaDdHZXVBNC8%257C' },
  zahra: { name: 'Merya Al Zahra', hotelId: 77010, key: 'beb25861a362c1574702f07eca5b8ce7175758376068c2999064345____VEwvOVN1LzV2Y2xKU0lEM0hBK1kxdkxHUThoNGtvQUlkQVVIOXlLUWFWbWxYTHBTTW5UaWxJUEUwcUdrZ3E5Ymhvbkg0U2FsNWVrV1MwZmVhT0V4SDhReDJCaTdXSzU1cDVkVk1sSXN2Y2wweEw1OXRVV2dvYk5Rd0s0a04wd2Y%257C' }
};

const ROOM_NAMES = {
  STD: 'ستوديو', OBA: 'جناح', OBACV: 'جناح غرفة نوم مع إطلالة على المدينة',
  TBA: 'جناح غرفتين', TBSS: 'جناح غرفتين سوبيريور',
  TBACV: 'جناح غرفتين مع إطلالة على المدينة', TBSSC: 'جناح غرفتين سوبيريور مع إطلالة على المدينة'
};

const BASE = 'https://booking.staygrid.com/webv2/index/index/key/';

function addDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function scrapeBranch(browser, code, checkin, checkout) {
  const b = BRANCHES[code];
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 2200 } });
  const page = await ctx.newPage();
  const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000);

  try {
    await page.goto(BASE + b.key, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.evaluate(([ci, co]) => {
      const f = Array.from(document.forms).find(x => x.elements['checkInMysql']);
      f.elements['checkInMysql'].value = ci;
      f.elements['checkOutMysql'].value = co;
      f.submit();
    }, [checkin, checkout]);

    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForSelector('[roomseq]', { state: 'attached', timeout: 45000 });

    const rows = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.accomodation-rate').forEach(blk => {
        const sq = blk.querySelector('[roomseq]');
        const pr = blk.querySelector('.pax-price.price');
        if (!sq || !pr) return;
        const m = (pr.textContent || '').match(/([\d,]+\.\d{2})/);
        if (!m) return;
        const left = (blk.innerText.match(/(\d+)\s*room\(s\)\s*left/) || [])[1];
        out.push({ seq: sq.getAttribute('roomseq'), total: parseFloat(m[1].replace(/,/g, '')), rooms_left: left ? parseInt(left, 10) : null });
      });
      return out;
    });

    const best = {};
    for (const r of rows) {
      const key = Buffer.from(r.seq.replace(/-/g, '+').replace(/_/g, '/') + '===', 'base64').toString('utf8').replace(/\u0000+$/, '');
      const row = { code: key, room: ROOM_NAMES[key] || key, total: Math.round(r.total * 100) / 100, per_night: Math.round((r.total / nights) * 100) / 100, rooms_left: r.rooms_left };
      if (!best[key] || row.total < best[key].total) best[key] = row;
    }
    const list = Object.keys(best).map(k => best[k]).sort((x, y) => x.total - y.total);

    return { branch: code, hotel: b.name, hotelId: b.hotelId, checkin, checkout, nights, currency: 'SAR', tax: 'incl', rooms: list, cheapest: list[0] || null };
  } finally {
    await page.screenshot({ path: 'shot-' + code + '.png', fullPage: true }).catch(() => {});
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const checkin = addDays(21);
  const checkout = addDays(23);
  const result = { generated_at: new Date().toISOString(), branches: {} };
  let failed = 0;

  for (const code of Object.keys(BRANCHES)) {
    try {
      result.branches[code] = await scrapeBranch(browser, code, checkin, checkout);
      if (!result.branches[code].rooms.length) failed++;
    } catch (e) {
      result.branches[code] = { branch: code, error: String(e).slice(0, 300) };
      failed++;
    }
  }

  await browser.close();
  fs.writeFileSync('rates.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failed) console.error('FAILED branches: ' + failed);
})();
