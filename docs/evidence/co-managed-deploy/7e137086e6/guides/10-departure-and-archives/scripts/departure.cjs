// Guide 10 — Departure and archives, on the disposable relationship accepted in guide 01
// (CM-REVIEW-20261026-01 Accept-7). Never White Rabbit. Kansas Farms is not touched here.
// CM_STOP_BEFORE_DEPARTURE=1 runs only the preparation/baseline (dry run kept under attempts/).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, sql, until, assert, OZ, pool, allocations, qa, receipt, origin, privateRoot, credential, qaSession, json } = C;
const root = path.resolve(__dirname, '..');
const name = process.env.CM_NAME || 'departure-recording';
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
    assert.equal(relState(), 'active', 'disposable relationship is active before the run');
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

    // ---------------- Preparation ----------------
    await chapter('Preparation: staff access, shared ticket, audiences, files, time');
    await asQa(`/msp/clients/${fx.clientId}?tab=co-managed`); await page.locator('#co-policy-user-search').waitFor({ timeout: 90000 });
    const qaId = sql(`select user_id from users where tenant='${OZ}' and email='qa@emeraldcity.oz'`);
    if (!await page.locator(`#co-policy-user-remove-${qaId}`).count()) {
      await page.locator('#co-policy-user-search').fill('QA'); await page.waitForTimeout(800);
      await page.locator('#co-policy-user-select').click(); await page.getByRole('option', { name: /^QA Tester/ }).first().click(); await page.locator('#co-policy-user-add').click();
      await page.locator(`#co-policy-user-access-${qaId}`).click(); await page.getByRole('option', { name: 'Collaborate', exact: true }).click();
      await shot('10-p-staff-access'); await page.locator('#co-policy-save').click();
      await until(() => sql(`select relationship_role from co_management_staff_assignments where tenant='${OZ}' and customer_tenant='${CUST}' and principal_id='${qaId}'`) === 'technician', 'QA technician assignment', 60000);
    }
    await check('qa-has-technician-access-to-the-disposable-relationship', true, { qaId });
    // Escalation requires an MSP SLA policy that resolves for this sponsor client (Oz has no default policy) ...
    const polName = 'CM-REVIEW-20261026-10 MSP policy';
    const p1 = sql(`select priority_id from priorities where tenant='${OZ}' and priority_name='P1 - Critical' limit 1`);
    const clientPolicy = () => sql(`select p.policy_name from clients c join sla_policies p on p.tenant=c.tenant and p.sla_policy_id=c.sla_policy_id where c.tenant='${OZ}' and c.client_id='${fx.clientId}'`);
    if (clientPolicy() !== polName) {
      await qs.fresh('/msp/settings/sla'); await page.locator('#sla-settings-trigger-1').click(); await page.locator('#add-sla-policy-button').click();
      await page.locator('#sla-policy-name').fill(polName);
      await page.locator('#sla-policy-clients').click(); await page.locator(`#sla-policy-clients-option-${fx.clientId}`).click(); await page.keyboard.press('Escape');
      await page.locator(`#sla-target-trigger-${p1}`).click(); await page.waitForTimeout(600);
      await page.locator(`#sla-target-response-${p1}`).click(); await page.getByRole('option', { name: '1 hour', exact: true }).click();
      await page.locator(`#sla-target-resolution-${p1}`).click(); await page.getByRole('option', { name: /^8 hours$|^1 day$|^4 hours$/ }).first().click();
      await shot('10-p-sla-policy'); await page.locator('#sla-policy-save').click();
      await until(() => clientPolicy() === polName, 'client SLA policy assigned', 60000);
    }
    await check('msp-sla-policy-applies-to-the-disposable-client', clientPolicy() === polName, { policy: polName });
    // ... and the customer's priorities mapped to MSP priorities.
    const mapped = () => Number(sql(`select count(*) from co_managed_sla_priority_mappings where customer_tenant='${CUST}' and relationship_id='${REL}' and msp_priority_id is not null`));
    await qs.fresh(`/msp/clients/${fx.clientId}?tab=co-managed`); const maps = page.locator('button[id^="co-sla-map-"]'); await maps.first().waitFor({ timeout: 90000 });
    const mapCount = await maps.count();
    if (mapped() < mapCount) {
      for (let i = 0; i < mapCount; i++) { const m = maps.nth(i); if ((await m.innerText()).trim() === 'P1 - Critical') continue; await m.click(); await page.getByRole('option', { name: 'P1 - Critical', exact: true }).click(); }
      await shot('10-p-sla-mapping'); await page.locator('#co-sla-save').click();
      await until(() => mapped() === mapCount, 'priority mappings saved', 60000);
    }
    await check('msp-maps-customer-priorities-to-its-sla', mapped() === mapCount, { mapCount });
    await asCustomer('/msp/tickets'); await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 });
    const title = `${P} shared ticket`;
    for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
    await page.locator('#ticket-quick-add-title').fill(title);
    const pickFirst = async (trigger) => { await page.locator(trigger).click(); const o = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first(); await o.waitFor(); const l = (await o.innerText()).trim(); await o.click(); return l; };
    await pickFirst('#ticket-quick-add-client-trigger'); await pickFirst('#ticket-quick-add-board-picker'); await page.waitForTimeout(800);
    if (/Select Status/i.test((await page.locator('#ticket-quick-add').innerText()).trim())) await pickFirst('#ticket-quick-add');
    await page.locator('#ticket-quick-add-create-open-btn').click(); await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 });
    const T = new URL(page.url()).pathname.split('/').at(-1); out.ticket = T; out.ticketTitle = title; save();
    await page.locator('#co-ticket-escalate').click(); const hd = page.getByRole('dialog').filter({ hasText: 'Handoff note' }).first();
    await hd.getByLabel('Handoff note').fill(`${P} please take this departure test ticket`);
    await shot('10-p-escalate'); await hd.getByRole('button', { name: 'Escalate to MSP', exact: true }).click();
    await until(() => sql(`select responsibility from co_management_ticket_work where tenant='${CUST}' and ticket_id='${T}'`) === 'msp', 'handed to MSP', 60000);
    const route = `/msp/co-management/tickets/${CUST}/${REL}/${T}`; out.route = route; save();
    await check('customer-native-ticket-escalated-to-msp', true, { ticket: T, route });
    await asQa(route); await page.getByText(title).filter({ visible: true }).first().waitFor({ timeout: 90000 });
    const shared = await post('Shared IT teams', 'shared');
    await qs.fresh(route); const mspPrivate = await post('My organization only', 'msp-private');
    await asCustomer('/msp/tickets/' + T); const custPrivate = await post(/^Private to/, 'customer-private');
    // Commercial MSP time on the shared ticket.
    await asQa(route); const addTime = page.locator('#ticket-details-properties-add-time-entry-btn'); await addTime.waitFor({ timeout: 60000 });
    await addTime.click(); const saveTime = page.locator('#time-entry-dialog-save-dialog-btn'); await saveTime.waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
    await inspect('10-p-time-form'); await shot('10-p-time-form');
    if (process.env.CM_STOP_BEFORE_DEPARTURE === '1') return { status: 'partial', limitations: ['dry run: stopped at the time-entry form'] };
    const note = `${P} commercial time`;
    const svc = page.getByRole('combobox').filter({ hasText: /Select a service/i }).first();
    if (await svc.count()) { await svc.click(); await page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first().click(); }
    await page.locator('#time-entry-dialog-duration-hours-0').fill('0'); await page.locator('#time-entry-dialog-duration-minutes-0').fill('15');
    await page.getByPlaceholder('Add notes').fill(note);
    await shot('10-p-time-filled'); await saveTime.click();
    const entry = await until(() => { const x = sql(`select row_to_json(e) from (select entry_id, billable_duration, billing_mode, work_item_type, approval_status, invoiced from time_entries where tenant='${OZ}' and notes='${note}') e`); return x ? JSON.parse(x) : null; }, 'time entry persisted', 60000);
    out.timeEntry = entry; save();
    await check('msp-commercial-time-recorded-on-shared-ticket', entry.work_item_type === 'co_managed', entry);

    // ---------------- 1. Baseline ----------------
    await chapter('1. Record the cutoff baseline');
    await qs.fresh(route); await page.getByText(shared.text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    let txt = await bodyText();
    await check('msp-sees-shared-and-own-private-not-customer-private', txt.includes(shared.text) && txt.includes(mspPrivate.text) && !txt.includes(custPrivate.text));
    for (const f of [shared, mspPrivate]) { const b = await fetchBytes(f.href); await check(`msp-downloads-${f.label}-file-before-cutoff`, b.ok && b.sha256 === f.sha256, b); }
    await shot('10-1-msp-baseline');
    await asCustomer('/msp/tickets/' + T); await openComposer(); await page.getByText(custPrivate.text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    txt = await bodyText();
    await check('customer-sees-shared-and-own-private-not-msp-private', txt.includes(shared.text) && txt.includes(custPrivate.text) && !txt.includes(mspPrivate.text));
    await shot('10-1-customer-baseline');
    await asQa('/msp/co-managed/archive'); await page.waitForTimeout(2500); await shot('10-1-archive-baseline');
    const archiveBefore = Number(sql(`select count(*) from co_managed_participation_evidence where tenant='${OZ}' and customer_tenant='${CUST}' and relationship_id='${REL}'`));
    const baseline = { pool: pool(), allocation: alloc(), relationship: relState(), evidenceRows: archiveBefore, manifests: Number(sql(`select count(*) from co_managed_archive_manifests where tenant='${OZ}' and customer_tenant='${CUST}' and relationship_id='${REL}'`)) };
    out.baseline = baseline; save(); await mark('baseline', baseline);

    // ---------------- 2. End the relationship ----------------
    await chapter('2. End the disposable relationship');
    // Keep an already-open MSP tab on the shared ticket for the stale-session check in section 3.
    await qs.fresh(route); const stale = await ctx.newPage(); await stale.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await stale.getByText(title).filter({ visible: true }).first().waitFor({ timeout: 90000 }); await stale.screenshot({ path: dir + '/10-2-stale-tab-before.png' });
    await page.bringToFront();
    await qs.fresh(`/msp/co-management/departure?operationId=${fx.operationId}`);
    await page.locator('#co-departure-review').click(); await page.locator('#co-departure-confirm-confirm').waitFor();
    const dlg = (await page.getByRole('dialog').filter({ hasText: 'End this relationship?' }).first().innerText()).replace(/\s+/g, ' ');
    await shot('10-2-review-departure');
    await check('departure-dialog-names-counterpart-and-effects', /End this relationship\?/.test(dlg) && dlg.includes(fx.workspace.replace(/ IT$/, '')) || /End co-management with/.test(dlg), { dlg });
    await page.locator('#co-departure-confirm-confirm').click();
    await until(() => relState() === 'terminated', 'relationship terminated', 120000);
    await page.locator('#co-departure-refresh').click(); await page.getByText('This co-management relationship has ended', { exact: false }).first().waitFor({ timeout: 60000 });
    await shot('10-2-ended');
    await qs.fresh(`/msp/clients/${fx.clientId}?tab=co-managed`); await page.waitForTimeout(2500);
    const clientStatus = (await page.locator('[id$="-status"]').first().innerText()).replace(/\s+/g, ' ');
    await check('client-view-shows-relationship-ended', /Relationship ended/.test(clientStatus), { clientStatus }); await shot('10-2-client-ended');
    await check('customer-tenant-still-exists', Number(sql(`select count(*) from tenants where tenant='${CUST}'`)) === 1);

    // ---------------- 3. Old access paths ----------------
    await chapter('3. Test the old access paths');
    qs.invalidate(); await qs.fresh(null); // fresh QA cookies shared with the stale tab
    await stale.bringToFront(); let staleResult = 'composer unavailable';
    try {
      const show = stale.locator('#ticket-details-conversation-show-comment-editor-btn'); if (await show.isVisible()) await show.click();
      await stale.locator('[contenteditable=true]').last().fill(`${P} stale-tab write after cutoff`, { timeout: 8000 });
      await stale.locator('#ticket-details-conversation-add-comment-btn').click({ timeout: 8000 }); await stale.waitForTimeout(4000); staleResult = 'submitted';
    } catch (e) { staleResult = 'blocked: ' + e.message.split('\n')[0]; }
    await stale.screenshot({ path: dir + '/10-3-stale-tab-after.png' });
    const staleWrites = Number(sql(`select count(*) from comments where tenant='${CUST}' and ticket_id='${T}' and note::text like '%stale-tab write after cutoff%'`) || 0);
    await check('stale-open-tab-cannot-write-after-cutoff', staleWrites === 0, { staleResult, staleWrites });
    await stale.close(); await page.bringToFront();
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
    await check('allocation-released-once-and-pool-capacity-unchanged', after.allocation.state === 'released' && after.allocation.released_at && after.closures === 1 && after.pool.capacity === baseline.pool.capacity, after);
    const te = json(`select row_to_json(e) from (select entry_id, billable_duration, billing_mode, approval_status, invoiced from time_entries where tenant='${OZ}' and entry_id='${entry.entry_id}') e`);
    await check('msp-commercial-time-survives-departure', Boolean(te) && te.billable_duration === entry.billable_duration, te);
    await check('neither-organization-deleted', Number(sql(`select count(*) from tenants where tenant in ('${OZ}','${CUST}')`)) === 2);
    receipt(dir, 'db-after', { pool: pool(), allocations: allocations() });
    return { status: 'partial', limitations: [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
