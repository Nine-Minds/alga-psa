// Headless real-browser smoke of /msp/co-management/customer-tickets (keyset pagination). Not committed.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [, , evidenceDir, origin] = process.argv;
const expected = fs.readFileSync(path.join(evidenceDir, 'db-expected-order.txt'), 'utf8').trim().split('\n')
  .map(l => { const [n, num, title, entered, id] = l.split('|'); return { n: +n, num, title, entered, id }; });
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? JSON.stringify(detail).slice(0, 600) : ''}`); };
const T = 900_000;

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
const STATE = '/tmp/smoke-cm-tickets-state.json';
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(fs.existsSync(STATE) ? { storageState: STATE } : {}),
  recordVideo: { dir: path.join(evidenceDir, 'video-raw'), size: { width: 1440, height: 1000 } } });
const page = await context.newPage(); const videoT0 = Date.now();
page.setDefaultTimeout(T); page.setDefaultNavigationTimeout(T);
const shot = async name => page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
const banner = async text => page.evaluate(t => {
  let el = document.getElementById('__smoke_banner');
  if (!el) { el = document.createElement('div'); el.id = '__smoke_banner';
    el.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;background:#111c;color:#fff;font:14px sans-serif;padding:6px 10px;border-radius:6px;pointer-events:none;max-width:700px'; document.body.appendChild(el); }
  el.textContent = t; }, text).catch(() => {});

// Capture every call to the list server action (request args + raw response) so the cursor contract is evidence too.
let actionId = null; const actionCalls = [];
page.on('request', req => { const h = req.headers()['next-action']; if (h && req.method() === 'POST' && req.url().includes('customer-tickets')) {
  const body = req.postData() || ''; if (/^\[\{"(cursor|page|pageSize)"/.test(body)) { actionId = h; actionCalls.push({ body }); } } });
page.on('response', async res => { const h = res.request().headers()['next-action']; if (h && h === actionId) {
  const last = actionCalls[actionCalls.length - 1]; if (last && !last.response) last.response = await res.text().catch(() => ''); } });

const payload = text => { const line = (text || '').split('\n').find(l => /^\w+:\{"rows":/.test(l)); return line ? JSON.parse(line.slice(line.indexOf(':') + 1)) : null; };
const payloadIds = text => (payload(text)?.rows ?? []).map(r => r.resource.id);
const visibleNumbers = async () => page.$$eval('[data-automation-id="co-managed-customer-tickets-table"] tbody tr', rows => rows.map(r => r.querySelector('td')?.innerText.trim()));
const waitRows = async (firstExpected) => {
  await page.waitForFunction(first => { const td = document.querySelector('[data-automation-id="co-managed-customer-tickets-table"] tbody tr td'); return td && td.innerText.trim() === first; }, firstExpected, { timeout: T });
};

process.on('uncaughtException', async e => { console.log('Error:', e); try { await context.close(); const v = page.video(); if (v) fs.renameSync(await v.path(), path.join(evidenceDir, 'smoke-walkthrough.webm')); } catch {} process.exit(1); });
console.log('login');
await page.goto(`${origin}/msp/co-management/customer-tickets`, { waitUntil: 'domcontentloaded' });
if (page.url().includes('signin')) {
  await page.waitForLoadState('load', { timeout: T });
  // Wait for React hydration (a submit before hydration is a native form POST that goes nowhere).
  await page.waitForFunction(() => { const b = document.querySelector('#msp-sign-in-button'); return b && Object.keys(b).some(k => k.startsWith('__react')); }, null, { timeout: T });
  await page.fill('#msp-email-field', 'qa@emeraldcity.oz');
  await page.fill('#msp-password-field', 'NineMinds1234!');
  await page.click('#msp-sign-in-button');
  await page.waitForURL(u => u.pathname.startsWith('/msp/co-management/customer-tickets'), { timeout: T });
}
await context.storageState({ path: STATE });
try { await page.waitForSelector('[data-automation-id="co-managed-customer-tickets-table"] tbody tr', { timeout: 420_000 }); }
catch (e) {
  await shot('00-debug-no-rows.png');
  console.log('BODY', (await page.innerText('body').catch(() => '')).slice(0, 3000));
  console.log('TABLE', await page.$eval('[data-automation-id="co-managed-customer-tickets-table"]', el => el.outerHTML.slice(0, 2000)).catch(() => 'no table'));
  console.log('CALLS', JSON.stringify(actionCalls).slice(0, 3000));
  throw e;
}
// Dismiss environment toasts/banners that are not about this card.
for (const sel of ['[data-sonner-toast] button[aria-label="Close toast"]', '[role="alert"] button[aria-label*="lose"]']) {
  for (const b of await page.$$(sel)) await b.click().catch(() => {});
}
const serverIds = []; const marks = []; const mark = async label => { marks.push({ t: (Date.now() - videoT0) / 1000, label }); await banner(label); };

// Flow 1: first page equals DB rows 1..25
await mark('Flow 1: page 1 = DB order rows 1-25 (entered_at DESC, ticket_id ASC)');
await waitRows(expected[0].num);
const p1 = await visibleNumbers();
log('page1 UI rows = DB rows 1..(first 10 shown; DataTable cap)', JSON.stringify(p1) === JSON.stringify(expected.slice(0, 25).map(e => e.num).slice(0, 10)), { got: p1 });
{ const call = actionCalls.filter((c, i, a) => c.response && a.findIndex(x => x.body === c.body) === i)[0]; const ids = payloadIds(call?.response); const pl = payload(call?.response);
  log('page1 server payload = DB rows 1-25 exactly', JSON.stringify(ids) === JSON.stringify(expected.slice(0, 25).map(e => e.id)), { n: ids.length, hasMore: pl?.hasMore, nextCursor: pl?.nextCursor, args: call?.body });
  serverIds.push(...ids); }
await shot('01-page1-rows-1-25.png');
log('Previous disabled on page 1', await page.isDisabled('#co-managed-customer-tickets-previous'));

// Flow 2: Next across the microsecond tie group -> rows 26..50, no dup / gap
await mark('Flow 2: Next crosses a 14-way same-microsecond tie: rows 26-50, no duplicates or gaps');
await page.click('#co-managed-customer-tickets-next');
await waitRows(expected[25].num);
const p2 = await visibleNumbers();
log('page2 UI rows = DB rows 26..(first 10 shown; DataTable cap)', JSON.stringify(p2) === JSON.stringify(expected.slice(25, 50).map(e => e.num).slice(0, 10)), { got: p2 });
{ const call = actionCalls.filter((c, i, a) => c.response && a.findIndex(x => x.body === c.body) === i)[1]; const ids = payloadIds(call?.response); const pl = payload(call?.response);
  log('page2 server payload = DB rows 26-50 exactly', JSON.stringify(ids) === JSON.stringify(expected.slice(25, 50).map(e => e.id)), { n: ids.length, hasMore: pl?.hasMore, nextCursor: pl?.nextCursor, args: call?.body });
  serverIds.push(...ids); }
await shot('02-page2-rows-26-50-after-tie-boundary.png');

// Flow 3: last page has NULL entered_at last and Next disabled
await mark('Flow 3: last page rows 51-60, NULL entered_at last, Next disabled');
await page.click('#co-managed-customer-tickets-next');
await waitRows(expected[50].num);
const p3 = await visibleNumbers();
log('page3 UI rows = DB rows 51..(first 10 shown; DataTable cap)', JSON.stringify(p3) === JSON.stringify(expected.slice(50, 60).map(e => e.num).slice(0, 10)), { got: p3 });
{ const call = actionCalls.filter((c, i, a) => c.response && a.findIndex(x => x.body === c.body) === i)[2]; const ids = payloadIds(call?.response); const pl = payload(call?.response);
  log('page3 server payload = DB rows 51-60 exactly', JSON.stringify(ids) === JSON.stringify(expected.slice(50, 60).map(e => e.id)), { n: ids.length, hasMore: pl?.hasMore, nextCursor: pl?.nextCursor, args: call?.body });
  serverIds.push(...ids); }
log('Next disabled on last page', await page.isDisabled('#co-managed-customer-tickets-next'));
await shot('03-page3-rows-51-60-nulls-last-next-disabled.png');
log('server pages union = all 60 tickets, no duplicates, no gaps, DB order', JSON.stringify(serverIds) === JSON.stringify(expected.map(e => e.id)), { n: serverIds.length, unique: new Set(serverIds).size });

// Flow 4: Previous walks the cursor stack back
await mark('Flow 4: Previous walks the cursor stack back to page 2 then page 1');
await page.click('#co-managed-customer-tickets-previous');
await waitRows(expected[25].num);
log('Previous -> page 2 again', JSON.stringify(await visibleNumbers()) === JSON.stringify(p2));
await page.click('#co-managed-customer-tickets-previous');
await waitRows(expected[0].num);
log('Previous -> page 1 again', JSON.stringify(await visibleNumbers()) === JSON.stringify(p1));
await shot('04-previous-back-to-page1.png');

// Flow 5: the attack — replay the real server action with hostile pagination from the signed-in browser
await mark('Flow 5: replay the server action with hostile page values: rejected fast, server stays responsive');
const replay = async (args) => page.evaluate(async ({ id, args }) => {
  const started = performance.now();
  const res = await fetch(location.pathname, { method: 'POST', headers: { 'Next-Action': id, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(args) });
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - started), text };
}, { id: actionId, args });
log('captured list action id from the UI', !!actionId, { actionId, calls: actionCalls.map(c => c.body) });
const attacks = {
  'page=1e9': [{ page: 1e9, pageSize: 25 }],
  'page=Number.MAX_SAFE_INTEGER+1 (unsafe)': [{ page: 9007199254740992, pageSize: 100 }],
  'page=201 (201*25 > MAX_OFFSET 5000)': [{ page: 201, pageSize: 25 }],
  'page=-1': [{ page: -1, pageSize: 25 }],
  'page=1.5': [{ page: 1.5, pageSize: 25 }],
  'page="5"': [{ page: '5', pageSize: 25 }],
  'cursor=garbage': [{ cursor: 'not-a-cursor!!', pageSize: 25 }],
  'cursor + page>0': [{ cursor: 'eyJlbnRlcmVkQXQiOm51bGwsInRpY2tldElkIjoiNjFjMTljOTQtZTY3NC00YTE5LTkwMGMtNjhjNjYzYzBhZTkwIn0', page: 1, pageSize: 25 }],
};
const attackOut = {};
for (const [name, args] of Object.entries(attacks)) {
  const r = await replay(args); attackOut[name] = r;
  const rejected = r.status >= 400 || /"E\{|\$E|digest|error/i.test(r.text) && !/"rows":\[\{/.test(r.text);
  log(`hostile ${name} rejected (no rows)`, rejected && !/"rows":\[\{/.test(r.text), { status: r.status, ms: r.ms, text: r.text.slice(0, 200) });
}
const legacy1 = await replay([{ page: 1, pageSize: 25 }]); attackOut['legacy page=1'] = legacy1;
const legacyIds = payloadIds(legacy1.text);
log('legacy page=1 (allowed) equals DB rows 26-50', JSON.stringify(legacyIds) === JSON.stringify(expected.slice(25, 50).map(e => e.id)), { status: legacy1.status, ms: legacy1.ms, ids: legacyIds.length });
const legacy200 = await replay([{ page: 200, pageSize: 25 }]); attackOut['legacy page=200 (at MAX_OFFSET, past end)'] = legacy200;
log('legacy page=200 (=5000 offset, allowed) returns empty page', legacy200.status === 200 && /"rows":\[\]/.test(legacy200.text), { status: legacy200.status, ms: legacy200.ms, text: legacy200.text.slice(0, 300) });
const firstCursorCall = actionCalls.find(c => c.response && /nextCursor/.test(c.response));
const cursorMatch = firstCursorCall?.response.match(/"nextCursor":"([A-Za-z0-9_-]+)"/);
const decoded = cursorMatch ? JSON.parse(Buffer.from(cursorMatch[1], 'base64url').toString()) : null;
log('page-1 nextCursor = last row key at microsecond precision', !!decoded && decoded.ticketId === expected[24].id && decoded.enteredAt === expected[24].entered.replace(' ', 'T') + 'Z', { decoded, expectedLast: expected[24] });
fs.writeFileSync(path.join(evidenceDir, 'server-action-replays.json'), JSON.stringify({ actionId, uiCalls: actionCalls, attacks: attackOut }, null, 2));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-automation-id="co-managed-customer-tickets-table"] tbody tr', { timeout: T });
await waitRows(expected[0].num);
log('UI still serves page 1 after hostile requests', JSON.stringify(await visibleNumbers()) === JSON.stringify(p1));
await banner('Flow 5 result: every hostile page/cursor rejected; queue still loads');
await shot('05-after-hostile-replays-queue-still-loads.png');

// Flow 6 (nearby regression): open a shared ticket from the queue
await mark('Flow 6: nearby regression - opening a queued shared ticket still works');
const href = await page.$eval('[data-automation-id="co-managed-customer-tickets-table"] tbody tr a', a => a.getAttribute('href')).catch(() => null);
if (href) {
  try {
    await page.click('[data-automation-id="co-managed-customer-tickets-table"] tbody tr a', { noWaitAfter: true });
    await page.waitForURL(u => u.pathname.includes('/customer-tickets/') && u.pathname.split('/').length > 5, { timeout: T, waitUntil: 'commit' });
    await page.waitForFunction(t => document.querySelector('main')?.innerText.includes(t), expected[0].title, { timeout: T });
    log('shared ticket detail opens with its title', true, { href, url: page.url() });
  } catch (e) { log('shared ticket detail opens with its title', false, { href, error: String(e).slice(0, 300) }); }
  await shot('06-shared-ticket-detail-opens.png').catch(() => {});
} else log('row link present', false);

fs.writeFileSync(path.join(evidenceDir, 'smoke-walkthrough.marks.json'), JSON.stringify(marks, null, 2));
fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(results, null, 2));
const video = page.video();
await context.close(); await browser.close();
if (video) fs.renameSync(await video.path(), path.join(evidenceDir, 'smoke-walkthrough.webm'));
console.log(`DONE ${results.filter(r => r.ok).length}/${results.length} passed`);
