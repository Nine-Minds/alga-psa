// clientIntegration:F003 on the production build: absent / single / multiple / ended / inconsistent /
// forbidden client relationships, and exact expected identity for writes.
//  - forbidden: the Oz Technician viewer (no co-management manage) and a tampered relationship URL fail closed;
//  - multiple / inconsistent: reversible SQL fixtures on the disposable "Accept-3/Accept-4" workspaces
//    (operation client mapping and relationship sponsor client), restored before the scenario ends;
//  - stale write: two tabs on White Rabbit access policy; the stale tab's save is refused and changes nothing.
const fs = require('fs'), path = require('path');
const { scenario, sql, until, credential } = require('./runtime.cjs');
const { actors, json } = require('./common.cjs');
const root = process.env.CM_ROOT;
const OZ = 'fa7f912f-6b62-463e-85cc-ffedab47ac44', WRC = 'e1d953b4-4f14-41fe-8f2c-828dd85a15b8', KSC = 'c1f52e41-5f29-46db-88a8-4341fbbe2868';
const WR = 'c64b2666-7dd6-4c61-8ced-4b233f628e61', REL = '2be5cb32-91e8-491a-9ec4-16ab019c7d40', KS_REL = 'ad0808b5-25df-4e95-987a-aa650c8ba24f', T = '99a62c02-6235-408f-9755-959424089b76';
const A3 = { op: '5b406971-1c66-4d33-94fe-b61dbeb4bf90', tenant: '2953aec7-3e03-47d8-8637-171af6c6e5c0', rel: 'f45b6c1c-7cf3-4c3a-ba95-9e64bd03dd00', client: 'eed8f432-dbf3-4836-adb8-3001bc185524' };
const A4 = { op: 'cf2e86f0-9713-4b07-bb43-37e2e06fb15e', tenant: 'a53cba7c-fa11-482f-972d-579637aa09f5', rel: '7b58d23d-4a4b-4eec-8b7e-ded9c079923b', client: '4d392586-2f08-4fca-b8f9-1bd19135902c' };
const QA = '86952555-610c-4737-be41-a9236cfa9cdb';
const viewer = () => ({ name: 'viewer', ...credential('cm-review-20261026-03-viewer.json') });
const mapOp = (o, client) => sql(`update co_managed_provisioning_operations set request = jsonb_set(request, '{clientId}', to_jsonb('${client}'::text)) where tenant='${OZ}' and operation_id='${o.op}'`);
const mapRel = (o, client) => sql(`update co_management_relationships set sponsor_client_id='${client}' where tenant='${o.tenant}' and relationship_id='${o.rel}'`);
const fixtureState = () => json(`select o.operation_id, o.request->>'clientId' as op_client, r.sponsor_client_id from co_managed_provisioning_operations o join co_management_relationships r on r.relationship_id=o.relationship_id where o.operation_id in ('${A3.op}','${A4.op}')`);
const policyRev = () => json(`select revision from co_management_relationships where tenant='${WR}' and relationship_id='${REL}'`)[0].revision;
const failClosed = (t) => /not available|not found|don't have|do not have|permission|access denied|cannot|unavailable|no access|Restricted ticket|access may have changed/i.test(t);
const permissionWorded = (t) => /permission|not allowed|don't have access|do not have access|not authorized|access may have changed|Restricted/i.test(t);

(async () => {
  const r = await scenario(root, '06-f003-relationship-states', async ({ page, ctx, actor, go, check: hard, shot, inspect, chapter, dir, out }) => {
    const failed = [];
    const check = async (id, cond, data) => { try { await hard(id, cond, data); } catch (e) { failed.push(id); out.assertions.push({ id, passed: false, at: new Date().toISOString(), data }); } };
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const main = async () => (await page.locator('main').innerText().catch(() => page.locator('body').innerText()));
    receipt('fixture-before', fixtureState());
    try {
      await chapter('Forbidden: the Oz Technician viewer has no co-management management and cannot open shared work directly');
      await actor(viewer());
      await go('/msp/co-management'); const v1 = await main(); await shot('01-viewer-co-management');
      await go(`/msp/clients/${WRC}?tab=co-managed`); const v2 = await main(); await shot('02-viewer-client-tab');
      const v2Controls = await page.locator('#co-policy-save, #client-details-co-managed-seats-seats-open, #co-policy-user-add').count();
      await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`); const v3 = await main(); await shot('03-viewer-shared-ticket');
      const absentForViewer = json(`select c.client_id from clients c where c.tenant='${OZ}' and c.is_inactive=false and c.client_id not in (select (request->>'clientId')::uuid from co_managed_provisioning_operations where tenant='${OZ}') order by c.client_name limit 1`)[0];
      await go(`/msp/clients/${absentForViewer.client_id}`); await page.waitForTimeout(2500);
      const viewerAbsentSummary = await page.locator('#client-details-co-managed-summary').innerText().catch(() => '');
      const viewerEnable = await page.getByRole('button', { name: /Enable co-managed IT/ }).count(); await shot('03b-viewer-absent-client');
      receipt('viewer', { coManagement: v1.slice(0, 600), clientTab: v2.slice(0, 900), sharedTicket: v3.slice(0, 600), clientTabWriteControls: v2Controls, absentSummary: viewerAbsentSummary, absentEnableButtons: viewerEnable });
      await check('f010-non-manager-is-never-offered-enable', viewerEnable === 0 && !/Enable/.test(viewerAbsentSummary), { viewerAbsentSummary: viewerAbsentSummary || '(no co-managed summary rendered for this reader)', viewerEnable });
      await check('viewer-co-management-fails-closed', !/Select the co-managed workspace to manage/.test(v1) && !/co-policy-workspace/.test(await page.content()), { text: v1.slice(0, 200) });
      await check('viewer-co-management-message-names-the-permission-not-a-reload', permissionWorded(v1) && !/Reload to try again/.test(v1), { text: v1.slice(0, 200) });
      await check('viewer-client-tab-offers-no-management-writes', v2Controls === 0, { controls: v2Controls });
      await check('viewer-shared-ticket-fails-closed-without-content', failClosed(v3) && !/CM-REVIEW-20261026-07 final conversation/.test(v3), { text: v3.slice(0, 200) });

      await chapter('Inconsistent identity: QA opens White Rabbit ticket 000009 under the ended Kansas relationship id');
      await actor(actors.qa());
      await go(`/msp/co-management/tickets/${WR}/${KS_REL}/${T}`); const q1 = await main(); await shot('04-mismatched-relationship-url');
      await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`); const q2 = await main();
      receipt('identity-urls', { mismatched: q1.slice(0, 600), control: q2.slice(0, 300) });
      await check('mismatched-relationship-fails-closed', failClosed(q1) && !/CM-REVIEW-20261026-07 final conversation/.test(q1), { text: q1.slice(0, 200) });
      await check('matching-relationship-control-opens', /CM-REVIEW-20261026-07 final conversation/.test(q2), {});

      await chapter('States on client tabs: single (White Rabbit), ended (Kansas), absent (a client never set up)');
      const absentClient = json(`select c.client_id, c.client_name from clients c where c.tenant='${OZ}' and c.is_inactive=false and c.client_id not in (select (request->>'clientId')::uuid from co_managed_provisioning_operations where tenant='${OZ}') order by c.client_name limit 1`)[0];
      await go(`/msp/clients/${WRC}?tab=co-managed`); const single = await page.locator('[data-automation-id="client-details-co-managed-summary"], #client-details-co-managed-summary').first().innerText().catch(async () => (await main()).slice(0, 300));
      await go(`/msp/clients/${KSC}?tab=co-managed`); const ended = await main(); await shot('05-ended');
      await go(`/msp/clients/${absentClient.client_id}?tab=co-managed`); const absent = await main(); await shot('06-absent');
      receipt('states', { single, ended: ended.slice(0, 800), absent: absent.slice(0, 800), absentClient });
      await check('single-shows-active-and-manage', /Active/.test(single) && /Manage/.test(single), { single });

      await chapter('F010: seat allocation 1 -> 2 -> 1 refreshes the summary in the same document');
      const seats = () => json(`select seats from co_managed_allocations where operation_id='1a832203-2725-4b90-8d4b-90207ebfc23f'`)[0].seats;
      await go(`/msp/clients/${WRC}?tab=co-managed`); await page.locator('#client-details-co-managed-seats-seats-open').waitFor({ timeout: 60000 });
      const origin0 = await page.evaluate(() => performance.timeOrigin); const seats0 = seats();
      const setSeats = async (n) => { await page.locator('#client-details-co-managed-seats-seats-open').click(); await page.locator('#client-details-co-managed-seats-seats-input').fill(String(n));
        await page.locator('#client-details-co-managed-seats-seats-save').click(); await until(() => seats() === n, 'seats ' + n, 60000); await page.waitForTimeout(2500); };
      await setSeats(seats0 + 1); const summaryUp = await page.locator('#client-details-co-managed-summary').innerText(); await shot('05b-seats-up');
      await setSeats(seats0); const summaryDown = await page.locator('#client-details-co-managed-summary').innerText();
      const origin1 = await page.evaluate(() => performance.timeOrigin);
      receipt('f010-seat-refresh', { seats0, summaryUp, summaryDown, sameDocument: origin0 === origin1 });
      await check('f010-summary-refreshes-after-allocation-without-reload', origin0 === origin1 && new RegExp(`of ${seats0 + 1}`).test(summaryUp) && new RegExp(`of ${seats0}\\b`).test(summaryDown), { summaryUp, summaryDown });
      await check('ended-shows-history-no-setup', /Relationship ended/.test(ended) && /history/i.test(ended) && !/Set up co-managed|Enable co-managed/i.test(ended), {});
      await check('absent-offers-setup-to-the-manager', /Enable|Set up/i.test(absent), { client: absentClient.client_name });

      await chapter('Multiple: map disposable Accept-3 onto White Rabbit (fixture); the client tab requires an explicit choice');
      mapOp(A3, WRC); mapRel(A3, WRC); receipt('fixture-multiple', fixtureState());
      await go(`/msp/clients/${WRC}?tab=co-managed`); await page.waitForTimeout(2000); const multi = await page.locator('body').innerText(); await shot('07-multiple');
      fs.writeFileSync(path.join(dir, '07-multiple.txt'), multi);
      await inspect('07-multiple-dom');
      const picker = page.locator('#client-details-co-managed-relationship');
      await picker.click(); await page.waitForTimeout(1000);
      const options = await page.locator('[role=option]').allInnerTexts(); fs.writeFileSync(path.join(dir, '07b-options.json'), JSON.stringify(options, null, 2)); await shot('07b-choose');
      const noWritesBeforeChoice = await page.locator('#co-policy-save').count();
      await check('multiple-requires-explicit-selection-listing-both', /Multiple co-managed relationships/.test(multi) && options.some((o) => /White Rabbit IT/.test(o)) && options.some((o) => /Accept-3 IT/.test(o)) && noWritesBeforeChoice === 0, { options, noWritesBeforeChoice });
      await page.locator('[role=option]', { hasText: 'White Rabbit IT' }).first().click(); await page.waitForTimeout(3000); await shot('08-multiple-selected');
      const chosen = await page.locator('body').innerText(); fs.writeFileSync(path.join(dir, '08-multiple-selected.txt'), chosen);
      await check('explicit-selection-resolves-the-exact-relationship', await page.locator('#co-policy-save').count() > 0 && await page.locator(`#co-policy-user-access-${QA}`).count() > 0, {});
      mapOp(A3, A3.client); mapRel(A3, A3.client);

      await chapter('Inconsistent: Accept-4 relationship points at another sponsor client than its operation (fixture)');
      mapRel(A4, WRC); receipt('fixture-inconsistent', fixtureState());
      await go(`/msp/clients/${A4.client}?tab=co-managed`); await page.waitForTimeout(2000); const inc = await page.locator('body').innerText(); await shot('09-inconsistent');
      fs.writeFileSync(path.join(dir, '09-inconsistent.txt'), inc);
      await go(`/msp/clients/${WRC}?tab=co-managed`); await page.waitForTimeout(1500); const incWr = await page.locator('body').innerText();
      mapRel(A4, A4.client);
      receipt('inconsistent', { accept4Tab: inc.slice(0, 900), whiteRabbitTab: incWr.slice(0, 400) });
      await check('inconsistent-relationship-is-not-adopted-by-the-other-client', !/Accept-4 IT/.test(incWr), {});
      const incOffersSetup = /Enable co-managed|Set up co-managed|\bEnable\b/.test(inc);
      await check('inconsistent-client-is-named-and-offers-neither-setup-nor-management', /needs attention/i.test(inc) && !incOffersSetup && !/Save access/.test(inc) && !/not enabled/i.test(inc), { offersSetup: incOffersSetup });

      await chapter('Stale write: two tabs on White Rabbit staff access; the stale save is refused');
      const original = json(`select 1`)[0]; const rev0 = policyRev();
      await go(`/msp/clients/${WRC}?tab=co-managed`); await page.locator(`#co-policy-user-access-${QA}`).waitFor({ timeout: 60000 });
      const stale = await ctx.newPage(); await stale.goto(page.url(), { waitUntil: 'domcontentloaded' }); await stale.locator(`#co-policy-user-access-${QA}`).waitFor({ timeout: 60000 });
      const current = (await page.locator(`#co-policy-user-access-${QA}`).innerText()).trim();
      await page.locator(`#co-policy-user-access-${QA}`).click(); await page.waitForTimeout(600);
      const opt = page.locator('[role=option]:not([aria-disabled="true"])').filter({ hasNotText: new RegExp('^' + current + '$') }).first(); const other = (await opt.innerText()).trim(); await opt.click();
      await page.locator('#co-policy-save').click(); await until(() => policyRev() > rev0, 'fresh save', 30000);
      const rev1 = policyRev();
      await stale.locator(`#co-policy-user-access-${QA}`).click(); await stale.waitForTimeout(600);
      await stale.locator('[role=option]:not([aria-disabled="true"])').filter({ hasNotText: new RegExp('^(' + current + '|' + other + ')$') }).first().click().catch(async () => {
        await stale.locator('[role=option]').filter({ hasText: new RegExp('^' + current + '$') }).first().click(); });
      await stale.locator('#co-policy-save').click(); await stale.waitForTimeout(4000);
      const staleText = await stale.locator('body').innerText(); await stale.screenshot({ path: path.join(dir, '10-stale-save.png'), fullPage: true });
      const rev2 = policyRev(); receipt('stale-write', { rev0, rev1, rev2, current, other, message: (staleText.match(/[^\n]*(conflict|changed|reload|could not|refresh)[^\n]*/gi) || []).slice(0, 5) });
      await check('stale-save-refused-and-db-unchanged', rev2 === rev1 && /reload|changed|conflict|could not/i.test(staleText), { rev0, rev1, rev2 });
      await stale.close();
      await page.reload(); await page.locator(`#co-policy-user-access-${QA}`).waitFor({ timeout: 60000 });
      await page.locator(`#co-policy-user-access-${QA}`).click(); await page.waitForTimeout(600);
      await page.locator('[role=option]').filter({ hasText: new RegExp('^' + current + '$') }).first().click();
      await page.locator('#co-policy-save').click(); await until(() => policyRev() > rev2, 'access restored', 30000);
      await check('access-restored', (await page.locator(`#co-policy-user-access-${QA}`).innerText()).trim() === current, { current });
      return { status: failed.length ? 'failed' : 'passed', failedAssertions: failed, limitations: ['multiple and inconsistent states were produced with reversible SQL fixtures on disposable workspaces: the product deliberately offers no path that creates them'] };
    } finally {
      mapOp(A3, A3.client); mapRel(A3, A3.client); mapRel(A4, A4.client); receipt('fixture-after', fixtureState());
    }
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
