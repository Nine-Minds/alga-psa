// Reproducible LOCAL tickets-list load-time baseline.
//
// Fetches timing from the LOCAL dev server (do NOT use production timing — prod
// numbers are not reproducible and cannot be re-measured after a change). Drives
// real Chromium (Playwright), signs in with the dev-printed credentials, and
// captures Navigation Timing + LCP + JS resource weight for /msp/tickets.
//
// Run from the repo root with the dev server up (cd server && npm run dev):
//   BASE=http://localhost:3000 \
//   LOGIN_EMAIL='glinda@emeraldcity.oz' LOGIN_PASSWORD='<dev-printed-pw>' \
//   node ee/docs/plans/2026-06-15-tickets-list-bundle-reduction/measure-tickets-baseline.mjs
//
// The dev entrypoint prints fresh MSP credentials in the server log on every boot.
//
// PORT NOTE: nx next:dev listens on :3000 but .env.local sets NEXTAUTH_URL/HOST=:3001,
// so UNauthenticated protected routes 307 to absolute http://localhost:3001/... (dead).
// We sign in directly at :3000/auth/msp/signin; once the session cookie is set,
// protected routes render on :3000 and we measure those.
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.LOGIN_EMAIL;
const PASSWORD = process.env.LOGIN_PASSWORD;
const TICKETS = `${BASE}/msp/tickets`;
const SIGNIN = `${BASE}/auth/msp/signin`;
const log = (...a) => console.log(...a);

async function collect(page) {
  return await page.evaluate(async () => {
    const lcp = await new Promise((resolve) => {
      let v = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) v = e.renderTime || e.loadTime || e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {}
      setTimeout(() => resolve(v), 800);
    });
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const js = res.filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name));
    const sum = (k) => js.reduce((a, r) => a + (r[k] || 0), 0);
    return {
      ttfb_ms: Math.round(nav.responseStart || 0),
      dcl_ms: Math.round(nav.domContentLoadedEventEnd || 0),
      load_ms: Math.round(nav.loadEventEnd || 0),
      lcp_ms: Math.round(lcp || 0),
      js_chunks: js.length,
      js_transfer_kb: Math.round(sum('transferSize') / 1024),
      js_decoded_kb: Math.round(sum('decodedBodySize') / 1024),
      resources: res.length,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);

  log('→ sign-in', SIGNIN);
  await page.goto(SIGNIN, { waitUntil: 'domcontentloaded' });
  await page.locator('#msp-email-field').waitFor({ state: 'visible', timeout: 60000 });
  await page.fill('#msp-email-field', EMAIL);
  await page.fill('#msp-password-field', PASSWORD);
  await page.click('#msp-sign-in-button').catch(() => {}); // post-login redirect to dead :3001 — tolerated
  await page.waitForTimeout(5000);

  // Warm-up compile of the route (dev compiles on demand — first hit not representative).
  await page.goto(TICKETS, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(4000);
  if (!page.url().includes('/msp/tickets')) {
    log('!! not on tickets route — auth failed. url:', page.url());
    await browser.close();
    process.exit(2);
  }

  const samples = [];
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/msp/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.goto(TICKETS, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const m = await collect(page);
    m.wall_ms = Date.now() - t0;
    samples.push(m);
    log(`  sample ${i + 1}:`, JSON.stringify(m));
  }

  const med = (k) => { const v = samples.map((s) => s[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const keys = ['ttfb_ms', 'dcl_ms', 'load_ms', 'lcp_ms', 'wall_ms', 'js_chunks', 'js_transfer_kb', 'js_decoded_kb', 'resources'];
  log('=== SUMMARY (median of', samples.length, 'samples) ===');
  log(JSON.stringify({ base: BASE, median: Object.fromEntries(keys.map((k) => [k, med(k)])) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('MEASURE ERROR:', e); process.exit(1); });
