import { chromium } from '@playwright/test';
const [, , out, url, title] = process.argv;
const b = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, storageState: '/tmp/smoke-cm-tickets-state.json' });
const p = await c.newPage(); const t0 = Date.now();
await p.goto(url, { waitUntil: 'commit', timeout: 1_500_000 });
await p.waitForFunction(t => document.body.innerText.includes(t), title, { timeout: 1_500_000 }).then(() => console.log('PASS detail shows title', (Date.now() - t0) / 1000, 's', p.url()), e => console.log('FAIL', String(e).slice(0, 200)));
await p.screenshot({ path: out, fullPage: true });
await b.close();
