// Guide 01 — Customer onboarding. Two disposable clients:
//   CM-REVIEW-20261026-01 Accept  → provisioned from the client's Co-managed IT tab, invitation resent, accepted (kept for guide 10)
//   CM-REVIEW-20261026-01 Cancel  → provisioned with a lost response + Retry recovery, then cancelled while unclaimed
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, sql, until, assert, OZ, pool, allocations, qa, sink, actionId, receipt, origin, privateRoot, qaSession } = C;
const root = path.resolve(__dirname, '..');
const name = process.env.CM_NAME || 'onboarding-recording';
const SUFFIX = 'CM-REVIEW-20261026-01';
const RUN = process.env.CM_RUN ? '-' + process.env.CM_RUN : '';
const opFor = (w) => C.json(`select row_to_json(o) from (select operation_id, customer_tenant, relationship_id, allocation_id, state, invitation_sent_at, invitation_delivery_error, request->>'clientId' client_id, request->>'visibilityMode' visibility, request->>'escalationBoardId' board from co_managed_provisioning_operations where tenant='${OZ}' and request->>'workspaceName'='${w}' order by created_at desc limit 1) o`);
const opCount = (w) => Number(sql(`select count(*) from co_managed_provisioning_operations where tenant='${OZ}' and request->>'workspaceName'='${w}'`));
const alloc = (id) => C.json(`select row_to_json(a) from (select allocation_id, seats, state, released_at from co_managed_allocations where tenant='${OZ}' and allocation_id='${id}') a`);

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const qs = qaSession({ page, actor, go, mark });
    const fixture = { suffix: SUFFIX }; const save = () => receipt(dir, 'fixtures', fixture);
    const poolStart = pool(); receipt(dir, 'db-before', { pool: poolStart, allocations: allocations() });
    // Preparation: two seats are needed (accept + cancel fixtures). Other agents change allocations concurrently,
    // so if the pool is short, add the shortfall through the pool editor (configured simulator) as guide 02 documents.
    if (poolStart.capacity - poolStart.allocated < 2) {
      await chapter('Preparation: add pool capacity (simulator)');
      const target = poolStart.allocated + 2; await qs.fresh('/msp/co-managed'); const qty = page.locator('#co-managed-seat-quantity'); await qty.waitFor();
      await qty.fill(String(target)); await page.locator('#co-managed-review-purchase').click(); await page.locator('#co-managed-confirm-purchase').waitFor(); await shot('01-0-capacity-review');
      await page.locator('#co-managed-confirm-purchase').click(); await until(() => pool().capacity >= target, 'capacity ' + target, 120000);
      await check('preparation-pool-capacity-added', true, { before: poolStart, after: pool() });
    }
    const pickOption = async (trigger, nameOrRe) => { await page.locator(trigger).click(); const o = page.getByRole('option', { name: nameOrRe, exact: typeof nameOrRe === 'string' }).first(); await o.waitFor(); const label = (await o.innerText()).trim(); await o.click(); return label; };
    // Other agents share this server; if the QA session was revoked mid-run, sign in again through the form and return.
    // QA is limited to 5 sessions and other agents sign in as QA continuously; recover the revoked session through the form.
    const goQa = (route) => qs.fresh(route);
    const reloadQa = () => qs.reload();
    const statusText = async () => (await page.locator('[id$="-status"]').first().innerText()).replace(/\s+/g, ' ').trim();

    async function createClient(label) {
      const clientName = `${SUFFIX} ${label}${RUN}`;
      const existing = sql(`select client_id from clients where tenant='${OZ}' and client_name='${clientName}' limit 1`);
      if (existing) { await mark('client-reused', { clientName, clientId: existing }); return { clientName, clientId: existing }; }
      await goQa('/msp/clients'); await page.locator('#create-client-button').click(); await page.locator('#client-name').fill(clientName);
      await shot(`01-${label.toLowerCase()}-create-client`);
      await page.locator('#create-view-client-btn').click(); await page.waitForURL(/\/msp\/clients\/[a-f0-9-]{36}/, { timeout: 90000 });
      const clientId = new URL(page.url()).pathname.split('/').at(-1); await mark('client-created', { clientName, clientId });
      return { clientName, clientId };
    }
    async function fillSetup({ clientId, clientName }, label, visibility) {
      await goQa(`/msp/clients/${clientId}?tab=co-managed`);
      const submit = page.locator('[id$="-setup-submit"]').first(); await submit.waitFor({ timeout: 90000 });
      const workspace = `${clientName} IT`, email = `cm-review-20261026-01-${label.toLowerCase()}${RUN}@cmreview.test`;
      await page.locator('[id$="-workspace-name"]').first().fill(workspace);
      await page.locator('[id$="-admin-firstName"]').first().fill('Review'); await page.locator('[id$="-admin-lastName"]').first().fill(label + ' Admin');
      await page.locator('[id$="-admin-email"]').first().fill(email);
      await page.locator('input[id$="-seats"][type=number]').first().fill('1');
      const vis = await pickOption('[id$="-visibility"]', visibility);
      const board = await pickOption('[id$="-escalation-board"]', 'General Support').catch(async () => pickOption('[id$="-escalation-board"]', /./));
      await shot(`01-${label.toLowerCase()}-setup-form`);
      return { workspace, email, visibility: vis, board, submit };
    }

    // ---------------- Section 1: accept fixture ----------------
    await chapter('1. Create one workspace for one client');
    const acc = await createClient('Accept'); Object.assign(fixture, { accept: { ...acc } }); save();
    let accOp = opFor(`${acc.clientName} IT`);
    if (!accOp) {
      const f = await fillSetup(acc, 'Accept', 'Oversight of the initial service desk board');
      Object.assign(fixture.accept, { workspace: f.workspace, adminEmail: f.email, visibility: f.visibility, escalationBoard: f.board }); save();
      await f.submit.click();
      const seen = new Set();
      accOp = await until(async () => { seen.add((await statusText().catch(() => '')).match(/Queued|Preparing workspace|Awaiting customer acceptance|Provisioning failed/)?.[0]); const o = opFor(f.workspace); return o?.state === 'pending_acceptance' && o.invitation_sent_at ? o : null; }, 'accept fixture awaiting acceptance', 180000);
      for (let i = 0; i < 20 && !/Awaiting customer acceptance/.test(await statusText()); i++) { await page.waitForTimeout(1500); }
      await mark('observed-status-labels', [...seen].filter(Boolean));
    }
    Object.assign(fixture.accept, { operationId: accOp.operation_id, customer: accOp.customer_tenant, relationship: accOp.relationship_id, allocationId: accOp.allocation_id }); save();
    await reloadQa(); await page.locator('[id$="-status"]').first().waitFor({ timeout: 90000 }); await page.waitForTimeout(1500);
    const accStatus = await statusText(); await shot('01-1-awaiting-acceptance');
    await check('one-workspace-for-this-client-awaiting-acceptance', /Awaiting customer acceptance/.test(accStatus) && opCount(fixture.accept.workspace || `${acc.clientName} IT`) === 1 && accOp.client_id === acc.clientId, { status: accStatus, operationId: accOp.operation_id });
    await check('seats-reserved-once', alloc(accOp.allocation_id)?.state === 'reserved' && Number(sql(`select count(*) from co_managed_allocations where tenant='${OZ}' and customer_tenant='${accOp.customer_tenant}'`)) === 1 && pool().allocated <= pool().capacity, { allocation: alloc(accOp.allocation_id), pool: pool() });
    await check('msp-has-no-live-relationship-before-acceptance', sql(`select state from co_management_relationships where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}'`) !== 'active');

    // ---------------- Section 3a: resend invitation (recovery control on existing setup) ----------------
    await chapter('3. Recover the existing setup (resend invitation)');
    const email = fixture.accept.adminEmail || `cm-review-20261026-01-accept${RUN}@cmreview.test`; fixture.accept.adminEmail = email; save();
    const mailsBefore = (await sink()).filter((m) => m.to?.includes(email)).length;
    await goQa(`/msp/clients/${acc.clientId}?tab=co-managed`);
    const retry = page.locator('[id$="-recovery-retry"]').first(); await retry.waitFor();
    const retryLabel = (await retry.innerText()).trim(); await retry.click(); await page.waitForTimeout(2500);
    await until(async () => (await sink()).filter((m) => m.to?.includes(email)).length > mailsBefore, 'resent invitation delivered', 120000);
    const afterResend = opFor(fixture.accept.workspace);
    await check('resend-keeps-one-workspace-and-one-allocation', retryLabel === 'Resend administrator invitation' && afterResend.operation_id === accOp.operation_id && afterResend.customer_tenant === accOp.customer_tenant && opCount(fixture.accept.workspace) === 1 && Number(sql(`select count(*) from co_managed_allocations where tenant='${OZ}' and customer_tenant='${accOp.customer_tenant}'`)) === 1, { retryLabel, mailCount: (await sink()).filter((m) => m.to?.includes(email)).length });
    await reloadQa(); await page.locator('[id$="-status"]').first().waitFor(); await shot('01-3-after-resend');

    // ---------------- Section 2: customer approval ----------------
    await chapter('2. Require customer approval');
    const mails = (await sink()).filter((m) => m.to?.includes(email));
    const mail = mails.at(-1); const link = mail.text?.match(/(https?:\/\/\S*\/auth\/team\/setup\S*)/) || mail.html?.match(/href="([^"]*\/auth\/team\/setup[^"]*)"/); assert.ok(link, 'setup link');
    receipt(dir, 'invitation-mail', { to: mail.to, subject: mail.subject, receivedCount: mails.length, setupPath: new URL(link[1].replaceAll('&amp;', '&')).pathname, note: 'token omitted' });
    const credFile = `cm-review-20261026-01-accept${RUN}-admin.json`;
    const password = 'CMr01!' + crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(`${privateRoot}/${credFile}`, JSON.stringify({ email, password, tenant: accOp.customer_tenant }), { mode: 0o600 });
    fixture.accept.credentialFile = credFile; save();
    const u = new URL(link[1].replaceAll('&amp;', '&')); qs.invalidate(); await ctx.clearCookies(); await page.goto(origin + u.pathname + u.search, { timeout: 120000 });
    await page.locator('#password').waitFor({ timeout: 90000 }); await shot('01-2-invitation-account-setup');
    await page.locator('#password').fill(password); await page.locator('#confirmPassword').fill(password); await page.locator('#create-team-account-button').click();
    await page.locator('#co-managed-accept-relationship').waitFor({ timeout: 120000 });
    const review = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await shot('01-2-review-relationship');
    const sess = await ctx.request.get(origin + '/api/auth/session').then((x) => x.json());
    await check('invited-admin-signed-into-the-exact-customer-workspace', sess.user?.tenant === accOp.customer_tenant && sess.user?.email === email);
    await check('review-shows-sponsor-scope-and-destination-queue', /Review your co-management relationship/i.test(review) && /Oz|Emerald/i.test(review) && review.includes(fixture.accept.escalationBoard || 'General Support'), { review: review.slice(0, 900) });
    await page.goto(origin + '/msp/tickets', { waitUntil: 'domcontentloaded' }); await page.locator('#co-managed-accept-relationship').waitFor({ timeout: 60000 });
    await check('deep-link-to-native-work-still-shows-acceptance-before-approval', await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).count() === 0);
    await page.locator('#co-managed-accept-relationship').click();
    await until(() => sql(`select state from co_management_relationships where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}'`) === 'active', 'relationship active', 120000);
    await go('/msp/tickets');
    await page.locator('#companyAddressLine1').or(page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true })).first().waitFor({ timeout: 120000 });
    if (await page.locator('#companyAddressLine1').count()) {
      await shot('01-2-first-run-setup');
      await page.locator('#companyAddressLine1').fill('1 Review Lane'); await page.locator('#companyCity').fill('Emerald City');
      await page.locator('#company-country-picker').click(); await page.getByText('United States', { exact: true }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForTimeout(700);
      for (let i = 0; i < 6; i++) { const skip = page.getByRole('button', { name: 'Skip', exact: true }); if (await skip.count() && await skip.isEnabled()) { await skip.click(); await page.waitForTimeout(500); } else break; }
      const finish = page.getByRole('button', { name: 'Finish Setup', exact: true }); if (await finish.count() && await finish.isEnabled()) { await finish.click(); await page.waitForTimeout(800); }
      await go('/msp/tickets');
    }
    await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 });
    await page.reload(); await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 }); await shot('01-2-customer-own-workspace');
    const grants = C.json(`select row_to_json(x) from (select (select count(*) from co_management_board_scopes where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}')::int board_scopes, (select count(*) from co_management_project_scopes where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}')::int project_scopes, (select count(*) from co_management_delegated_grants where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}')::int delegated_grants) x`);
    await check('customer-reaches-own-workspace-after-acceptance-with-no-projects-or-delegation', grants.project_scopes === 0 && grants.delegated_grants === 0, { relationship: sql(`select state from co_management_relationships where tenant='${accOp.customer_tenant}' and relationship_id='${accOp.relationship_id}'`), initialGrants: grants });
    qs.invalidate(); await goQa(`/msp/clients/${acc.clientId}?tab=co-managed`); await page.locator('[id$="-status"]').first().waitFor({ timeout: 90000 }); await page.waitForTimeout(2000);
    const active = await statusText(); await shot('01-2-msp-client-active');
    await check('msp-client-view-shows-active-and-no-cancel-setup', /Active/.test(active) && await page.getByRole('button', { name: 'Cancel setup', exact: true }).count() === 0 && alloc(accOp.allocation_id).state === 'active', { status: active, allocation: alloc(accOp.allocation_id) });

    // ---------------- Section 3b + 4: lost-response retry, then cancel an unclaimed setup ----------------
    await chapter('3. Recover the existing setup (lost response, Retry same details)');
    const can = await createClient('Cancel'); fixture.cancel = { ...can }; save();
    const f = await fillSetup(can, 'Cancel', 'Escalated tickets only'); Object.assign(fixture.cancel, { workspace: f.workspace, adminEmail: f.email, visibility: f.visibility }); save();
    const ids = actionId('provisionCoManagedWorkspaceAction'); assert.ok(ids.length, 'provision action id'); let intercepted = false;
    await page.route('**/*', async (route) => { if (!intercepted && ids.includes(route.request().headers()['next-action'])) { intercepted = true; await route.fetch(); await route.abort('connectionreset'); } else await route.continue(); });
    await f.submit.click();
    await until(() => intercepted, 'provision request executed then response dropped');
    const retryBtn = page.locator('[id$="-setup-submit"]').first();
    await until(async () => (await retryBtn.innerText()).trim() === 'Retry' && await retryBtn.isEnabled(), 'form offers Retry', 60000).catch(() => null);
    const first = await until(() => opFor(f.workspace), 'operation persisted despite lost response');
    await shot('01-3-lost-response-retry'); await page.unroute('**/*');
    const btnText = (await retryBtn.innerText().catch(() => '')).trim();
    const lostAlert = await page.getByRole('alert').filter({ hasText: /could not be confirmed/ }).first().innerText().catch(() => null);
    await check('lost-response-reports-unconfirmed-result-and-keeps-form', Boolean(lostAlert) && await page.locator('[id$="-workspace-name"]').first().inputValue() === f.workspace, { alert: lostAlert, button: btnText });
    await mark('after-lost-response', { button: btnText, operationId: first.operation_id });
    if (await retryBtn.count() && await retryBtn.isEnabled()) { await retryBtn.click(); await page.waitForTimeout(2500); }
    const canOp = await until(() => { const o = opFor(f.workspace); return o?.state === 'pending_acceptance' && o.invitation_sent_at ? o : null; }, 'cancel fixture awaiting acceptance', 180000);
    Object.assign(fixture.cancel, { operationId: canOp.operation_id, customer: canOp.customer_tenant, allocationId: canOp.allocation_id }); save();
    await check('retry-recovers-the-same-operation-one-workspace-one-allocation', canOp.operation_id === first.operation_id && opCount(f.workspace) === 1 && Number(sql(`select count(*) from co_managed_allocations where tenant='${OZ}' and customer_tenant='${canOp.customer_tenant}'`)) === 1, { operationId: canOp.operation_id, buttonAfterLostResponse: btnText });
    await goQa(`/msp/clients/${can.clientId}?tab=co-managed`); await page.locator('[id$="-status"]').first().waitFor({ timeout: 90000 });
    await until(async () => /Awaiting customer acceptance/.test(await statusText()), 'status shown', 60000);
    const poolBeforeCancel = pool(); await shot('01-3-cancel-fixture-awaiting');
    await check('cancel-fixture-holds-one-reserved-seat', alloc(canOp.allocation_id).state === 'reserved', { allocation: alloc(canOp.allocation_id), pool: poolBeforeCancel });

    await chapter('4. Cancel only an unclaimed workspace');
    await page.locator('[id$="-recovery-cancel"]').first().click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'Cancel workspace setup?' }).first(); await dlg.waitFor();
    const dlgText = (await dlg.innerText()).replace(/\s+/g, ' '); await shot('01-4-cancel-dialog');
    await check('cancel-dialog-explains-deletion', /Cancel workspace setup\?/.test(dlgText) && /Delete workspace and cancel/.test(dlgText), { dlgText });
    await page.locator('[id$="-recovery-cancel-confirm-button"]').first().click();
    const states = new Set();
    await until(() => { const o = opFor(f.workspace); states.add(o?.state + '/' + alloc(canOp.allocation_id)?.state); return o?.state === 'cancelled' ? o : null; }, 'cleanup finished', 180000);
    await mark('cancel-state-trace', [...states]);
    await reloadQa(); await page.locator('[id$="-status"]').first().waitFor({ timeout: 90000 }); await page.waitForTimeout(1500); await shot('01-4-cancelled');
    const after = alloc(canOp.allocation_id);
    await check('cancel-deletes-unclaimed-workspace-and-releases-seat-once', Number(sql(`select count(*) from tenants where tenant='${canOp.customer_tenant}'`)) === 0 && after.state === 'released' && after.released_at && Number(sql(`select count(*) from co_managed_allocations where tenant='${OZ}' and customer_tenant='${canOp.customer_tenant}'`)) === 1, { after, poolBefore: poolBeforeCancel, poolAfter: pool(), statesSeen: [...states] });
    await goQa(`/msp/clients/${acc.clientId}?tab=co-managed`); await page.locator('[id$="-status"]').first().waitFor({ timeout: 90000 }); await page.waitForTimeout(1500);
    await check('accepted-workspace-unaffected-by-cancellation', /Active/.test(await statusText()) && alloc(accOp.allocation_id).state === 'active');
    await goQa('/msp/co-managed'); await page.locator('#co-managed-seat-quantity').waitFor(); await page.waitForTimeout(1500); await shot('01-4-overview-final');
    receipt(dir, 'db-after', { pool: pool(), allocations: allocations(), accept: opFor(fixture.accept.workspace), cancel: opFor(fixture.cancel.workspace) });
    return { status: 'passed', limitations: [
      'Lost-response recovery was induced by aborting the provision action response in the browser (route interception) after the server executed it; Retry then reused the same form.',
      'Invitation mail is the configured SMTP sink, not a real mailbox. Worker-failure recovery and expired-invitation resend were not induced.',
      'Claimed-workspace cancellation refusal checked only as absence of Cancel setup on the accepted client (no direct probe).'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
