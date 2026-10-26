// Guide 10 — Departure and archives, on the disposable relationship accepted in guide 01
// (CM-REVIEW-20261026-01 Accept-7). Never White Rabbit. Kansas Farms is not touched here.
// Continuation of departure-recording (part 1 prepared content, recorded the baseline and ended the relationship,
// then failed its post-departure client-view assertion). Part 2 resumes from that receipt; it never ends anything.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, sql, until, assert, OZ, pool, allocations, qa, receipt, origin, privateRoot, credential, qaSession, json } = C;
const root = path.resolve(__dirname, '..');
const name = process.env.CM_NAME || 'departure-recording-continued';
const fx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../01-onboarding/onboarding-recording/fixtures.json'))).accept;
const CUST = fx.customer, REL = fx.relationship;
const stamp = process.env.CM_STAMP || String(Date.now()).slice(-6);
const P = `CM-REVIEW-20261026-10 ${stamp}`;

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    assert.ok(!/White Rabbit|Kansas/.test(fx.workspace), 'disposable relationship only');
    const qs = qaSession({ page, actor, go, mark });
    const cred = credential(fx.credentialFile); const customer = { name: 'accept7-admin', email: cred.email, password: cred.password };
    const out = { fixture: fx, prefix: P, files: [] }; const save = () => receipt(dir, 'receipt', out);
    const relState = () => sql(`select state from co_management_relationships where tenant='${CUST}' and relationship_id='${REL}'`);
    const alloc = () => json(`select row_to_json(a) from (select allocation_id, seats, state, released_at from co_managed_allocations where tenant='${OZ}' and allocation_id='${fx.allocationId}') a`);
    assert.equal(relState(), 'terminated', 'continuation runs after the part-1 departure');
    let custOn = false;
    const asCustomer = async (route) => { if (!custOn) { qs.invalidate(); await actor(customer); custOn = true; } await go(route); };
    const asQa = async (route) => { if (custOn) { qs.invalidate(); custOn = false; } await qs.fresh(route); };
    const openComposer = async () => {
      const entry = page.locator('#ticket-layout-toggle-entry'); if (await entry.count()) { await entry.click(); await page.waitForTimeout(800); }
      const show = page.locator('#ticket-details-conversation-show-comment-editor-btn'); await show.waitFor({ timeout: 60000 }); if (await show.isVisible()) await show.click();
      await page.locator('#ticket-details-conversation-audience-select').waitFor();
    };
    const post = async (audience, label, withFile = true) => {
      await openComposer();
      await page.locator('#ticket-details-conversation-audience-select').click();
      await page.getByRole('option', { name: audience, exact: typeof audience === 'string' }).first().click();
      const text = `${P} ${label}`, fileName = `cm-review-10-${label}-${stamp}.txt`, bytes = Buffer.from(text + '\n');
      await page.locator('[contenteditable=true]').last().fill(text);
      if (withFile) await page.locator('#co-shared-comment-files').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: bytes });
      await page.locator('#ticket-details-conversation-add-comment-btn').click();
      await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
      const f = { label, text };
      if (withFile) { const link = page.getByRole('link', { name: fileName, exact: true }).first(); await link.waitFor({ timeout: 60000 }); Object.assign(f, { fileName, href: await link.getAttribute('href'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); }
      out.files.push(f); save(); await shot(`10-p-${label}`); return f;
    };
    const fetchBytes = async (href) => { const res = await ctx.request.get(origin + href); return { status: res.status(), ok: res.ok(), sha256: res.ok() ? crypto.createHash('sha256').update(await res.body()).digest('hex') : null }; };
    const bodyText = async () => (await page.locator('main').first().innerText().catch(async () => page.locator('body').innerText())).replace(/\s+/g, ' ');

    const part1 = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../departure-recording/receipt.json')));
    const [shared, mspPrivate, custPrivate] = ['shared', 'msp-private', 'customer-private'].map((l) => part1.files.find((f) => f.label === l));
    const T = part1.ticket, title = part1.ticketTitle, route = part1.route, entry = part1.timeEntry, baseline = part1.baseline;
    Object.assign(out, { part1: { ticket: T, route, files: part1.files, timeEntry: entry, baseline } }); save();
    let txt;
    await chapter('2. End the disposable relationship (status after refresh and reload)');
    await qs.fresh(`/msp/co-management/departure?operationId=${fx.operationId}`); await page.waitForTimeout(2500);
    const landed = page.url(); txt = await bodyText(); await shot('10-2-departure-url-after-reload');
    await check('departure-link-after-reload-reports-ended-without-offering-departure', (/This co-management relationship has ended/.test(txt) || /Relationship ended/.test(txt)) && await page.locator('#co-departure-review').count() === 0, { landed });
    await qs.fresh(`/msp/clients/${fx.clientId}?tab=co-managed`); await page.waitForTimeout(2500);
    let status = (await page.locator('[id$="-status"]').first().innerText()).replace(/\s+/g, ' '); await shot('10-2-client-default-after-departure');
    await mark('client-view-default-after-departure', { status });
    if (!/Relationship ended/.test(status) && await page.locator('[id$="-co-managed-relationship"]').count()) {
      await page.locator('[id$="-co-managed-relationship"]').first().click(); await page.getByRole('option').filter({ hasText: fx.workspace }).first().click(); await page.waitForTimeout(2500);
      status = (await page.locator('[id$="-status"]').first().innerText()).replace(/\s+/g, ' '); await shot('10-2-client-ended-relationship');
    }
    await check('client-view-shows-relationship-ended-and-seats-released', /Relationship ended/.test(status) && /Seats released/.test(status), { status });
    await check('customer-tenant-still-exists', Number(sql(`select count(*) from tenants where tenant='${CUST}'`)) === 1);
    await chapter('3. Test the old access paths');
    await qs.fresh(null);
    for (const f of [shared, mspPrivate, custPrivate]) { const b = await fetchBytes(f.href); await check(`old-live-${f.label}-file-link-denied`, !b.ok, b); }
    await qs.fresh(route); await page.waitForTimeout(2500); txt = await bodyText(); await shot('10-3-old-route-fresh');
    await check('fresh-navigation-to-old-shared-route-shows-no-live-ticket', !txt.includes(shared.text) && !txt.includes(mspPrivate.text), { excerpt: txt.slice(0, 300) });
    await qs.fresh(`/msp/tickets/customer?workspace=${CUST}`); await page.waitForTimeout(2500); txt = await bodyText(); await shot('10-3-customer-queue');
    await check('msp-customer-ticket-queue-no-longer-lists-the-ticket', !txt.includes(title));
    await asCustomer('/msp/tickets/' + T); await openComposer().catch(() => {}); await page.getByText(custPrivate.text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    txt = await bodyText(); await shot('10-3-customer-native-ticket');
    await check('customer-keeps-native-ticket-shared-and-private-content', txt.includes(shared.text) && txt.includes(custPrivate.text) && !txt.includes(mspPrivate.text));
    await check('former-msp-live-sla-field-absent-for-customer', await page.locator('#co-ticket-sla-msp').count() === 0);
    const own = await fetchBytes(custPrivate.href); await mark('customer-own-private-file-after-cutoff', own);
    await go('/msp/co-management/export'); await page.locator('#co-export-passphrase').waitFor({ timeout: 60000 }); await shot('10-3-customer-export-available');
    await check('customer-export-still-offered-after-departure', true);

    // ---------------- 4. Retained evidence ----------------
    await chapter('4. Read only retained evidence');
    const openArchive = async () => {
      await qs.fresh('/msp/co-managed/archive');
      const work = page.locator(`[id="co-archive-work-${CUST}-${REL}-ticket-${T}"]`);
      for (let i = 0; i < 25 && !await work.count(); i++) { const next = page.locator('#co-archive-work-next'); await next.waitFor(); if (await next.isDisabled()) break; await next.click(); await page.waitForTimeout(600); }
      await work.click(); await page.waitForTimeout(2000);
    };
    await openArchive(); txt = await bodyText(); await shot('10-4-archive-retained'); await inspect('10-4-archive-retained');
    const archiveLinks = {};
    for (const f of [shared, mspPrivate]) {
      const link = page.getByRole('link', { name: f.fileName, exact: true }).first(); await link.waitFor({ timeout: 30000 });
      archiveLinks[f.label] = await link.getAttribute('href'); const b = await fetchBytes(archiveLinks[f.label]);
      await check(`retained-${f.label}-file-bytes-match`, b.ok && b.sha256 === f.sha256, b);
    }
    await check('archive-excludes-customer-private-content', !txt.includes(custPrivate.text) && await page.getByRole('link', { name: custPrivate.fileName, exact: true }).count() === 0);
    await check('archive-shows-author-organizations-and-history', /Oz/.test(txt) && txt.includes(shared.text), { excerpt: txt.slice(0, 600) });
    out.archiveLinks = archiveLinks; save();
    // Unrelated principal (White Rabbit customer admin, different organization) presenting a retained-file link.
    const alice = credential('reprovision-20261025-active-admin.json'); qs.invalidate(); await actor({ name: 'alice-unrelated', email: alice.email, password: alice.password }); custOn = false;
    const foreign = await fetchBytes(archiveLinks.shared); await check('unrelated-principal-denied-retained-file-link', !foreign.ok, foreign);
    // Customer post-departure local change.
    await asCustomer('/msp/tickets/' + T); let changeResult;
    try { await post('Internal', 'customer-after-departure', false); changeResult = 'posted'; }
    catch (e) { changeResult = 'not offered: ' + e.message.split('\n')[0]; await shot('10-4-customer-change-attempt'); }
    out.customerChange = changeResult; save(); await mark('customer-post-departure-change', changeResult);
    await openArchive(); txt = await bodyText(); await shot('10-4-archive-after-customer-change');
    await check('archive-does-not-track-customer-post-departure-state', !txt.includes(`${P} customer-after-departure`), { changeResult });

    // ---------------- 5. Seats and commercial continuity ----------------
    await chapter('5. Reconcile seats and commercial continuity');
    await qs.fresh('/msp/co-managed'); await page.locator('#co-managed-seat-quantity').waitFor(); await page.waitForTimeout(1500); await shot('10-5-overview-after');
    await page.reload(); await page.waitForTimeout(2000);
    const after = { pool: pool(), allocation: alloc(), closures: Number(sql(`select count(*) from co_managed_relationship_closures where tenant='${OZ}' and customer_tenant='${CUST}' and relationship_id='${REL}'`)) };
    out.after = after; save();
    await check('allocation-released-once-and-sponsor-subscription-kept', after.allocation.state === 'released' && after.allocation.released_at && after.closures === 1 && after.pool.source_reference === baseline.pool.source_reference && after.pool.capacity > 0, { ...after, baselineCapacity: baseline.pool.capacity, purchasesSinceBaseline: C.purchases().filter((x) => x.created_at > '2026-10-26T03:55:18') });
    const te = json(`select row_to_json(e) from (select entry_id, billable_duration, billing_mode, approval_status, invoiced from time_entries where tenant='${OZ}' and entry_id='${entry.entry_id}') e`);
    await check('msp-commercial-time-survives-departure', Boolean(te) && te.billable_duration === entry.billable_duration, te);
    await check('neither-organization-deleted', Number(sql(`select count(*) from tenants where tenant in ('${OZ}','${CUST}')`)) === 2);
    receipt(dir, 'db-after', { pool: pool(), allocations: allocations() });
    return { status: 'partial', limitations: [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
