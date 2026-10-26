// Guide 05 (Ticket queue operations) walkthrough as QA on the active White Rabbit relationship.
// Disposable tickets are created and escalated by Alice through the customer's native ticket screen.
// The interrupted-handback case drops one server-action response in the browser (labelled fault injection;
// the server still commits) to reach the product's reload-recovery path. sql() is read-only.
const fs = require('fs'), path = require('path');
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('../../03-access-policies/scripts/lib.cjs');
const { ids, qa, alice, sql, until, origin, esc, json } = L;

const SUFFIX = 'CM-REVIEW-20261026-05';
const EXPLICIT_BOARD = `${SUFFIX} Explicit board`;
const T = { a: `${SUFFIX} bulk A`, b: `${SUFFIX} bulk B`, c: `${SUFFIX} mixed C`, d: `${SUFFIX} mixed D`, e: `${SUFFIX} mixed E explicit` };
const CRITICAL = '6fdf4c04-6d0b-441b-a9bd-368c202f7e72';
const root = path.resolve(__dirname, '..');
const name = process.env.CM_SCENARIO || 'recording';

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const h = L.helpers(page, { mark, check, shot });
    const ticketId = (title) => sql(`select ticket_id from tickets where tenant='${ids.customer}' and title='${esc(title)}' limit 1`);
    const work = (t) => json(`select responsibility, grant_revoked_at, revision from co_management_ticket_work where tenant='${ids.customer}' and relationship_id='${ids.relationship}' and ticket_id='${t}'`)[0] || null;
    const handoffs = (t, note) => Number(sql(`select count(*) from co_management_ticket_handoffs where tenant='${ids.customer}' and ticket_id='${t}' and note='${esc(note)}'`));
    const receipts = {}; const saveR = () => fs.writeFileSync(dir + '/db-receipts.json', JSON.stringify(receipts, null, 2));
    const url = () => new URL(page.url()).searchParams;
    const rows = (text) => page.locator('tbody tr', { hasText: text });
    const search = async (text) => { await page.locator('#customer-tickets-search').fill(text); await page.locator('#customer-tickets-search').press('Enter'); };
    const exportCsv = async (file) => {
      await page.locator('#customer-tickets-share').click(); const pending = page.waitForEvent('download');
      await page.locator('#customer-tickets-export').click(); await (await pending).saveAs(dir + '/' + file); await page.keyboard.press('Escape');
      return fs.readFileSync(dir + '/' + file, 'utf8');
    };
    const selectRow = async (t) => { const row = page.locator('tbody tr').filter({ has: page.locator(`a[href*="/${t}?returnTo="]`) }); await row.locator('input[type=checkbox],button[role=checkbox]').first().click(); };

    // ---------------- Preparation ----------------
    await chapter('Preparation: disposable customer tickets escalated to the MSP');
    const PRIS = [L.PRIORITY.critical, L.PRIORITY.low];
    receipts.prereqBefore = { mappings: Object.fromEntries(PRIS.map((p) => [p, h.mappingRow(p) || ''])), clientPolicy: h.clientPolicy() }; saveR();
    await actor(qa);
    // Escalation needs an MSP SLA policy for the client and a priority mapping; guide 08's disposable policy is assigned temporarily.
    const restorePrereqs = await h.applyEscalationPrerequisites('CM-REVIEW-20261026-08 final-b MSP policy', PRIS);
    await check('prep-msp-escalation-prerequisites-applied', Boolean(PRIS.every((p) => h.mappingRow(p)) && h.clientPolicy()));
    await actor(alice);
    let explicitBoard = sql(`select board_id from boards where tenant='${ids.customer}' and board_name='${esc(EXPLICIT_BOARD)}'`);
    if (!explicitBoard) explicitBoard = await h.createBoard(EXPLICIT_BOARD, 'Disposable board outside the MSP board scope');
    const tickets = {};
    for (const [k, title] of Object.entries(T)) tickets[k] = ticketId(title) || await h.createTicket(title, k === 'e' ? EXPLICIT_BOARD : 'Service Desk');
    for (const [k, t] of Object.entries(tickets)) if (work(t)?.responsibility !== 'msp') await h.transition(t, '#co-ticket-escalate', `${SUFFIX} prepare MSP responsibility ${k.toUpperCase()}`);
    receipts.prepared = Object.fromEntries(Object.entries(tickets).map(([k, t]) => [k, { ticket: t, ...work(t) }])); saveR();
    await check('prep-five-msp-responsible-tickets', Object.values(tickets).every((t) => work(t)?.responsibility === 'msp'), receipts.prepared);
    await actor(qa); receipts.prereqRestore = await restorePrereqs(); saveR();
    await check('prep-escalation-prerequisites-restored-to-baseline', JSON.stringify(receipts.prereqRestore.after) === JSON.stringify(receipts.prereqBefore), receipts.prereqRestore);

    // ---------------- 1. Queue scope ----------------
    await chapter('1. Keep queue scope stable');
    await actor(qa); await go('/msp/tickets'); await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 });
    await page.locator('#ticketing-dashboard-search-tickets-input').fill('Oz native switch closet audit'); await page.waitForTimeout(2500);
    await check('1-native-all-tickets-lists-native-ticket', (await page.locator('body').innerText()).includes('Oz native switch closet audit'));
    await page.locator('#ticketing-dashboard-search-tickets-input').fill(SUFFIX); await page.waitForTimeout(2500);
    await check('1-native-desk-excludes-shared-work', !(await page.locator('tbody').innerText().catch(() => '')).includes(SUFFIX)); await shot('1-native-desk');
    await go('/msp/tickets/customer?queueView=working&workspace=all'); await page.locator('#customer-tickets-search').waitFor();
    await search(SUFFIX); await until(async () => await rows(SUFFIX).count() === 5, 'five working rows', 45000);
    await check('1-working-queue-lists-msp-responsible-work', true); await shot('1-working');
    await page.locator('#customer-tickets-toggle-filters').click();
    await h.choose('#customer-tickets-workspace', 'White Rabbit IT'); await h.choose('#customer-tickets-state', 'All statuses');
    await page.locator('#customer-tickets-view-oversight').click(); await until(() => url().get('queueView') === 'oversight', 'oversight view');
    await until(async () => await rows(SUFFIX).count() >= 4, 'oversight rows', 45000);
    const oversightCount = await rows(SUFFIX).count();
    await check('1-oversight-follows-customer-scope', url().get('workspace') === ids.customer && url().get('searchQuery') === SUFFIX, { oversightCount, note: 'oversight = Service Desk board scope plus explicit grants' }); await shot('1-oversight');
    await page.locator('#customer-tickets-view-working').click(); await until(async () => await rows(SUFFIX).count() === 5, 'working again', 45000);
    await page.getByRole('columnheader', { name: /^Ticket/ }).first().click(); await until(() => url().get('queueSort'), 'sort applied');
    const applied = Object.fromEntries(['queueView', 'workspace', 'queueState', 'searchQuery', 'queueSort', 'queueDirection'].map((k) => [k, url().get(k)]));
    await page.reload(); await rows(SUFFIX).first().waitFor({ timeout: 45000 });
    await check('1-reload-retains-applied-scope', Object.entries(applied).every(([k, v]) => url().get(k) === v) && await rows(SUFFIX).count() === 5, applied); await shot('1-reloaded');
    const orgShown = (await rows(SUFFIX).first().innerText()).includes('White Rabbit IT');
    const link = page.locator(`tbody tr a[href*="/${tickets.a}?returnTo="]`); await link.click();
    await page.getByText(T.a, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    await check('1-result-opens-qualified-shared-ticket', page.url().includes(`/${ids.customer}/${ids.relationship}/${tickets.a}`), { orgShown }); await shot('1-opened');
    await page.locator('#back-navigation-button').click(); await page.locator('#customer-tickets-search').waitFor();
    await check('1-return-navigation-restores-scope', Object.entries(applied).every(([k, v]) => url().get(k) === v), Object.fromEntries(url()));
    await check('1-displayed-organization-is-customer-workspace', orgShown);

    // ---------------- 2. Export ----------------
    await chapter('2. Export the full filtered set');
    const narrow = new URL(page.url()); narrow.searchParams.set('pageSize', '2'); await go(narrow.pathname + narrow.search);
    await until(async () => await rows(SUFFIX).count() === 2, 'two rows per page', 45000); await shot('2-paged');
    const csv = await exportCsv('filtered-working-export.csv');
    const lines = csv.trim().split(/\r?\n/); const header = lines[0];
    const counts = Object.fromEntries(Object.entries(T).map(([k, t]) => [k, csv.split(t).length - 1]));
    await check('2-export-includes-every-filtered-row-once', Object.values(counts).every((n) => n === 1) && lines.length === 6, { counts, rows: lines.length - 1, header });
    await check('2-export-only-this-customer-and-filter', lines.slice(1).every((l) => l.includes('White Rabbit IT') && l.includes(SUFFIX)), { header });

    // ---------------- 3. Return selected tickets once ----------------
    await chapter('3. Return selected tickets once');
    narrow.searchParams.set('pageSize', '25'); await go(narrow.pathname + narrow.search); await until(async () => await rows(SUFFIX).count() === 5, 'all rows', 45000);
    await selectRow(tickets.a); await selectRow(tickets.b);
    await page.locator('#customer-tickets-open').click();
    const composerText = await page.locator('body').innerText();
    await check('3-selected-count-and-labels-shown', /2 selected|2 tickets/i.test(composerText), { sample: composerText.match(/.{0,40}selected.{0,60}/i)?.[0] }); await shot('3-composer');
    const note3 = `${SUFFIX} bulk return ${Date.now()}`;
    await page.locator('#customer-tickets-note').fill(note3); await page.locator('#customer-tickets-submit').click();
    await until(() => work(tickets.a).responsibility === 'customer' && work(tickets.b).responsibility === 'customer', 'A and B returned', 60000);
    await page.getByText('Returned to customer IT', { exact: false }).first().waitFor({ timeout: 45000 }); await shot('3-outcomes');
    await check('3-only-selected-tickets-changed', ['c', 'd', 'e'].every((k) => work(tickets[k]).responsibility === 'msp'));
    await check('3-one-handoff-note-per-returned-ticket', handoffs(tickets.a, note3) === 1 && handoffs(tickets.b, note3) === 1);
    for (const k of ['a', 'b']) {
      await page.goto(origin + L.shared(tickets[k]), { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.locator('#co-ticket-history-open').waitFor({ timeout: 60000 });
      await page.reload(); await page.locator('#co-ticket-history-open').waitFor({ timeout: 60000 });
      const resp = (await page.locator('#co-ticket-responsibility').innerText().catch(() => ''));
      await page.locator('#co-ticket-history-open').click(); await page.locator('#co-ticket-history-list').getByText(note3, { exact: true }).waitFor();
      await check(`3-msp-reload-shows-customer-responsibility-and-note-${k}`, /White Rabbit IT/.test(resp) && await page.locator('#co-ticket-history-list').getByText(note3, { exact: true }).count() === 1, { resp });
      await shot('3-msp-history-' + k); await page.keyboard.press('Escape');
    }
    await actor(alice);
    for (const k of ['a', 'b']) {
      await go('/msp/tickets/' + tickets[k]); await page.locator('#co-ticket-history-open').click();
      await page.locator('#co-ticket-history-list').getByText(note3, { exact: true }).waitFor();
      await check(`3-customer-sees-same-note-${k}`, await page.locator('#co-ticket-history-list').getByText(note3, { exact: true }).count() === 1); await shot('3-customer-history-' + k);
    }

    // ---------------- 4. Recover interrupted or mixed results ----------------
    await chapter('4. Recover interrupted or mixed results');
    await actor(qa); await go('/msp/tickets/customer?queueView=working&workspace=all'); await search(SUFFIX);
    await until(async () => await rows(SUFFIX).count() >= 3, 'mixed rows', 45000);
    for (const k of ['c', 'd', 'e']) await selectRow(tickets[k]);
    await page.locator('#customer-tickets-open').click(); const note4 = `${SUFFIX} mixed return ${Date.now()}`;
    await page.locator('#customer-tickets-note').fill(note4); await shot('4-composer-three');
    // Customer changes C (hands it back itself) and revokes E's explicit grant after the MSP selected them.
    const cctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: dir + '/customer-session', size: { width: 1440, height: 1000 } } });
    try {
      const cp = await cctx.newPage(); const ch = L.helpers(cp, { mark, check, shot: async (n) => cp.screenshot({ path: dir + '/' + n + '.png', fullPage: true }) });
      await cp.goto(origin + '/auth/msp/signin', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await cp.waitForFunction(() => { const b = document.querySelector('#msp-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
      await cp.locator('#msp-email-field').fill(alice.email); await cp.waitForTimeout(800); await cp.locator('#msp-password-field').fill(alice.password); await cp.locator('#msp-sign-in-button').click();
      await until(async () => (await cctx.request.get(origin + '/api/auth/session').then((x) => x.json())).user?.email === alice.email, 'customer session', 45000);
      await ch.transition(tickets.c, '#co-ticket-handback', `${SUFFIX} customer takes C back`);
      await ch.transition(tickets.e, '#co-ticket-revoke', `${SUFFIX} customer revokes E`);
      await cp.screenshot({ path: dir + '/4-customer-changed.png', fullPage: true });
    } finally { await cctx.close(); }
    await check('4-customer-changed-selected-tickets', work(tickets.c).responsibility === 'customer' && Boolean(work(tickets.e).grant_revoked_at), { c: work(tickets.c), e: work(tickets.e) });
    const manifest = JSON.parse(fs.readFileSync(`/home/robert/alga-copies/feature-co-managed-it/server/${process.env.CM_REVIEW_DIST}/server/server-reference-manifest.json`, 'utf8'));
    const action = Object.entries(manifest.node).find(([, v]) => v.exportedName === 'bulkHandBackCoManagedTicketsAction')?.[0];
    let dropped = false, dropDone = false;
    await page.route('**/*', async (route) => {
      if (!dropped && route.request().headers()['next-action'] === action) { dropped = true; await route.fetch(); await route.abort('connectionreset'); dropDone = true; } else await route.continue();
    });
    await mark('fault injection: next bulk-return response will be dropped after the server commits', { actionFound: Boolean(action) });
    await page.locator('#customer-tickets-submit').click();
    await until(() => dropDone && work(tickets.d).responsibility === 'customer', 'D committed despite lost response', 60000);
    await page.unroute('**/*'); await page.waitForTimeout(1500); await shot('4-lost-response');
    const lostText = await page.locator('body').innerText();
    await mark('lost-response screen', { retryOffered: /Retry/i.test(lostText) });
    await page.reload(); await page.locator('#customer-tickets-resume-submit').waitFor({ timeout: 60000 });
    await check('4-reload-offers-interrupted-return-resume', await page.locator('#customer-tickets-resume-submit').isVisible()); await shot('4-resume-offered');
    await page.locator('#customer-tickets-resume-submit').click();
    await page.getByText('Returned to customer IT', { exact: false }).first().waitFor({ timeout: 60000 });
    const outcome = await page.locator('body').innerText(); await shot('4-mixed-outcomes');
    await check('4-outcomes-distinguish-returned-changed-denied', /Returned to customer IT/.test(outcome) && /Ticket changed/.test(outcome) && /Access denied/.test(outcome));
    await check('4-resume-creates-one-note-for-successful-item', handoffs(tickets.d, note4) === 1);
    await check('4-conflicted-and-denied-items-not-counted-returned', handoffs(tickets.c, note4) === 0 && handoffs(tickets.e, note4) === 0);
    receipts.final = Object.fromEntries(Object.entries(tickets).map(([k, t]) => [k, { ticket: t, ...work(t), handoffs3: handoffs(t, note3), handoffs4: handoffs(t, note4) }]));
    receipts.prereqFinal = { mappings: PRIS.map((p) => h.mappingRow(p) || ''), clientPolicy: h.clientPolicy() }; saveR();
    await go('/msp/tickets/customer?queueView=oversight&workspace=all'); await search(SUFFIX); await page.waitForTimeout(3000);
    await check('4-reread-oversight-excludes-revoked-and-keeps-returned', await page.locator(`tbody a[href*="/${tickets.e}?"]`).count() === 0 && await page.locator(`tbody a[href*="/${tickets.d}?"]`).count() === 1); await shot('4-reread');
    fs.writeFileSync(dir + '/fixture-tickets.json', JSON.stringify({ suffix: SUFFIX, tickets, titles: T, note3, note4, method: 'Tickets and boards created and escalated through the customer UI; no direct DB writes.' }, null, 2));
    return { status: 'passed', limitations: ['The lost-response case is produced by dropping one server-action response in the browser after the server committed it.', 'Existing fixture 000002 from the guide does not exist in the rebuilt environment; the disposable CM-REVIEW-20261026-05 set was used instead.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
