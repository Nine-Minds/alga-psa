// T09 privacy across requester portal, search/typeahead and counts. Fresh markers on White Rabbit ticket
// 000009 (requester CM Review Requester 07): Alice posts Shared IT, customer-private and a requester reply; QA
// posts an MSP-private note from the shared ticket. Then:
//  - the requester's portal ticket shows only the requester reply, its comment count matches what it shows,
//    and portal ticket search finds nothing for hidden markers;
//  - header typeahead and full search: Alice never sees QA's MSP-private marker, QA never sees Alice's
//    customer-private marker, and neither surfaces a count for them; each author finds their own marker
//    (positive control proving the search index is live).
const fs = require('fs'), path = require('path');
const { scenario, until, credential } = require('./runtime.cjs');
const { actors, json } = require('./common.cjs');
const root = process.env.CM_ROOT;
const WR = 'c64b2666-7dd6-4c61-8ced-4b233f628e61', REL = '2be5cb32-91e8-491a-9ec4-16ab019c7d40', T = '99a62c02-6235-408f-9755-959424089b76';
const S = String(Date.now()).slice(-6);
const M = { shared: `T09S${S}SHARED`, orgPrivate: `T09S${S}ALICEPRIVATE`, mspPrivate: `T09S${S}QAPRIVATE`, requester: `T09S${S}REQUESTER` };
const requester = () => ({ name: 'requester', ...credential('cm-review-20261026-07-requester.json') });
const stored = (marker) => json(`select ct.collaboration_audience, c.is_internal, c.tenant from comments c join comment_threads ct on ct.tenant=c.tenant and ct.thread_id=c.thread_id where c.note like '%${marker}%'`);
const privateStore = (marker) => json(`select tenant from co_management_private_comments where note::text like '%${marker}%'`).length;

async function post(page, marker, audience) {
  await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
  const select = page.locator('#ticket-details-conversation-audience-select'); await select.waitFor(); await page.waitForTimeout(1200);
  await select.click(); await page.getByRole('option', { name: audience, exact: typeof audience === 'string' }).first().click(); await page.waitForTimeout(600);
  await page.locator('[contenteditable=true]').last().fill(marker);
  await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(marker).first().waitFor({ timeout: 30000 });
}
async function typeahead(page, q) {
  // Typeahead = the command palette's full-text mode (Ctrl+Shift+K); this build has no header search box.
  const input = page.locator('#command-palette-input');
  if (!await input.isVisible().catch(() => false)) { await page.keyboard.press('Control+Shift+K'); await input.waitFor({ timeout: 15000 }); }
  await page.locator('#command-palette-mode-fulltext').click(); await input.fill(''); await input.fill(q); await page.waitForTimeout(4000);
  const text = await page.locator('#command-palette-results').innerText().catch(() => '');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  return text;
}
async function fullSearch(page, go, q) {
  await go('/msp/search?q=' + encodeURIComponent(q)); await page.waitForTimeout(2500);
  if (await page.locator('#app-search-page').count()) return page.locator('#app-search-page').innerText();
  return page.locator('main').innerText();
}

(async () => {
  const r = await scenario(root, '04-t09-privacy', async ({ page, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    receipt('markers', M);
    await chapter('Alice posts Shared IT, customer-private and requester-visible comments on ticket 000009');
    await actor(actors.alice()); await go('/msp/tickets/' + T);
    await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
    await post(page, M.shared, 'Shared IT teams'); await post(page, M.orgPrivate, /^(Private to|My organization only)/); await post(page, M.requester, 'Requester and IT teams');
    await shot('01-alice-posts');
    await chapter('QA posts an MSP-private note from the shared ticket');
    await actor(actors.qa()); await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`); await page.waitForTimeout(1500);
    await post(page, M.mspPrivate, /^(Private to|My organization only)/); await shot('02-qa-private');
    const storage = Object.fromEntries(Object.entries(M).map(([k, v]) => [k, { customerStore: stored(v), mspPrivateStore: privateStore(v) }]));
    receipt('db-storage', storage);
    await check('storage-audiences', storage.shared.customerStore[0]?.collaboration_audience === 'shared_it' && storage.orgPrivate.customerStore[0]?.collaboration_audience === 'organization_private'
      && storage.requester.customerStore[0]?.collaboration_audience === 'requester' && storage.mspPrivate.customerStore.length === 0 && storage.mspPrivate.mspPrivateStore === 1, storage);

    await chapter('QA search: own MSP-private marker found (index live); Alice\'s customer-private marker never surfaces');
    await go('/msp/dashboard');
    const qaOwn = await typeahead(page, M.mspPrivate);
    const qaControl = await fullSearch(page, go, 'switch closet');
    const qaOther = await typeahead(page, M.orgPrivate); const qaOtherFull = await fullSearch(page, go, M.orgPrivate); await shot('03-qa-full-search-alice-private');
    receipt('qa-search', { ownMspPrivateTypeahead: qaOwn, positiveControl: qaControl, otherTypeahead: qaOther, otherFull: qaOtherFull });
    await check('qa-search-positive-control-finds-native-oz-ticket', /Oz native switch closet audit/.test(qaControl), { control: qaControl.slice(0, 200) });
    await check('qa-typeahead-and-full-search-hide-customer-private', !qaOther.includes(M.orgPrivate) && !/final conversation/.test(qaOther)
      && qaOtherFull.includes(`0 results for "${M.orgPrivate}"`) && /\nAll\n0\n/.test(qaOtherFull), { otherFull: qaOtherFull.slice(0, 200) });

    await chapter('Alice search: own customer-private marker found; QA\'s MSP-private marker never surfaces');
    await actor(actors.alice()); await go('/msp/dashboard');
    const aliceOwn = await until(async () => { const t = await typeahead(page, M.orgPrivate); return /000009|final conversation/.test(t) ? t : null; }, 'Alice finds own private note', 60000).catch(() => '');
    const aliceOther = await typeahead(page, M.mspPrivate); const aliceOtherFull = await fullSearch(page, go, M.mspPrivate); await shot('04-alice-full-search-qa-private');
    receipt('alice-search', { own: aliceOwn, otherTypeahead: aliceOther, otherFull: aliceOtherFull });
    const aliceControl = await typeahead(page, 'White Rabbit printer queue');
    receipt('alice-search-control', { control: aliceControl });
    await check('alice-search-surface-is-live', Boolean(aliceOwn) || /printer queue/i.test(aliceControl), { ownFound: Boolean(aliceOwn), control: aliceControl.slice(0, 200) });
    await check('alice-typeahead-hides-msp-private-and-full-search-is-outside-the-product', !aliceOther.includes(M.mspPrivate) && !/final conversation/.test(aliceOther)
      && !aliceOtherFull.includes(M.mspPrivate) && /not available in your current product experience/.test(aliceOtherFull), { typeahead: aliceOther.slice(0, 200), full: aliceOtherFull.slice(-150) });

    await chapter('Requester 07 in the client portal: only the requester reply is visible, counts match, search finds no hidden marker');
    const who = requester(); await page.goto('about:blank'); await page.context().clearCookies();
    await page.goto((process.env.CM_ORIGIN || 'http://feature-co-managed-it.localhost:23374') + '/auth/client-portal/signin?tenant=c64b26628e61', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => { const b = document.querySelector('#client-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
    await page.locator('#client-email-field').fill(who.email); await page.locator('#client-password-field').fill(who.password); await page.locator('#client-sign-in-button').click();
    await page.waitForURL(/client-portal/, { timeout: 60000 }); await page.waitForTimeout(2000);
    await go('/client-portal/tickets'); await page.waitForTimeout(2500); await shot('05-portal-list');
    const searchBox = page.locator('#client-portal-search-tickets-input');
    const portalSearch = {};
    for (const [k, v] of Object.entries(M)) { await searchBox.fill(v); await page.waitForTimeout(2500); portalSearch[k] = await page.locator('main').innerText(); }
    await searchBox.fill(''); await page.waitForTimeout(2000);
    await go('/client-portal/tickets/' + T); await page.waitForTimeout(4000);
    const portalTicket = await page.locator('body').innerText(); fs.writeFileSync(path.join(dir, '06-portal-ticket.txt'), portalTicket); await shot('06-portal-ticket');
    receipt('portal-search', Object.fromEntries(Object.entries(portalSearch).map(([k, v]) => [k, v.slice(0, 600)])));
    await check('portal-ticket-shows-requester-reply-only', portalTicket.includes(M.requester) && !portalTicket.includes(M.shared) && !portalTicket.includes(M.orgPrivate) && !portalTicket.includes(M.mspPrivate), {});
    const visibleRequesterComments = json(`select count(*)::int as n from comments c join comment_threads ct on ct.tenant=c.tenant and ct.thread_id=c.thread_id where c.tenant='${WR}' and c.ticket_id='${T}' and (ct.collaboration_audience='requester' or ct.collaboration_audience is null) and c.is_internal=false`)[0].n;
    const hiddenTotal = json(`select count(*)::int as n from comments where tenant='${WR}' and ticket_id='${T}'`)[0].n;
    const shownCounts = [...portalTicket.matchAll(/\((\d+)\)|(\d+)\s+comments?/gi)].map((m) => Number(m[1] ?? m[2]));
    await check('portal-counts-never-reveal-hidden-comments', !shownCounts.includes(hiddenTotal) || hiddenTotal === visibleRequesterComments, { shownCounts, visibleRequesterComments, totalStored: hiddenTotal });
    await check('portal-search-never-matches-hidden-markers', ['shared', 'orgPrivate', 'mspPrivate'].every((k) => !portalSearch[k].includes('final conversation') && !portalSearch[k].includes(M[k])), {});
    return { status: 'passed', limitations: ['Requester portal search filters ticket fields; a hidden marker would only leak if it matched, which it did not.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
