// T09 on the admitted production build: task-conversation audiences on a customer project shared with the MSP.
// Alice grants Collaborate on the requester-visible project; QA posts Shared IT, MSP-private and Requester
// messages; Alice posts a customer-private message. Each reader sees only its permitted lanes: QA never sees the
// customer-private note, Alice never sees the MSP-private note, and the client-portal requester sees only the
// requester message. Stored audiences and stores are read back from the database. The grant is removed at the end.
const fs = require('fs'), path = require('path');
const { scenario, until, origin, credential, sql } = require('./runtime.cjs');
const { actors, json, WR, A, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const PID = 'eefd8378-f6ff-4212-94bb-57a7a96b393b', PN = 'CM-REVIEW-20261026-07 final requester project', TID = '7965ad44-0715-4bb4-88f8-6e6557b1f2da';
const R = A.relationship;
const portalSlug = (t) => { const h = t.replaceAll('-', ''); return h.slice(0, 6) + h.slice(-6); };
const scope = () => json(`select project_id, can_collaborate from co_management_project_scopes where tenant='${WR}' and project_id='${PID}'`);

(async () => {
  const r = await scenario(root, process.env.CM_SCENARIO || '04-t09-task-audiences', async ({ page, ctx, actor, go, mark, check, shot, chapter, states, dir }) => {
    const receipt = (n, d) => fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(d, null, 2));
    const opt = (n) => page.getByRole('option', { name: n, exact: true });
    const stamp = Date.now();
    const M = { shared: `T09-2D00 SHARED ${stamp}`, mspPrivate: `T09-2D00 MSP-PRIVATE ${stamp}`, requester: `T09-2D00 REQUESTER ${stamp}`, customerPrivate: `T09-2D00 WR-PRIVATE ${stamp}` };
    const route = `/msp/co-management/tasks/${WR}/${R}/${TID}`;
    const body = async () => page.locator('body').innerText();
    async function post(audience, text) {
      await page.locator('#co-task-conversation-new').click();
      await page.locator('#co-task-conversation-audience').click(); await opt(audience).click();
      await page.locator('#co-task-conversation-message [contenteditable=true], #co-task-conversation-message').first().click(); await page.keyboard.type(text);
      await page.locator('#co-task-conversation-submit').click();
      await page.locator('li[id^=co-task-comment-]').filter({ hasText: text }).waitFor({ timeout: 60000 });
    }
    async function openTask() { await go(route); await page.locator('#co-task-conversation-title').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500); }
    receipt('db-before', { scope: scope() });

    await chapter('Alice shares the requester-visible project with the MSP (Collaborate)');
    await actor(actors.alice()); await go('/msp/co-management');
    const access = page.locator('#co-policy-project-access-' + PID);
    if (!await access.count()) {
      await page.locator('#co-policy-project-search').fill(PN); await page.waitForTimeout(900);
      await page.locator('#co-policy-project-select').click(); await opt(PN).click(); await page.locator('#co-policy-project-add').click();
      await access.click(); await opt('Collaborate').click(); await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
    }
    await check('grant-collaborate-saved', scope().length === 1 && scope()[0].can_collaborate === true, scope());

    await chapter('QA posts Shared IT, MSP-private and Requester messages on the shared task');
    await actor(actors.qa()); await openTask();
    await post('Shared IT teams', M.shared); await post('My organization only', M.mspPrivate); await post('Requester and IT teams', M.requester);
    await shot('01-qa-three-audiences');

    await chapter('Alice reads the task: Shared IT and Requester visible, MSP-private absent; she posts a customer-private note');
    await actor(actors.alice()); await openTask();
    await page.locator('li[id^=co-task-comment-]').filter({ hasText: M.requester }).waitFor({ timeout: 60000 });
    let t = await body();
    await check('alice-sees-shared-and-requester-not-msp-private', t.includes(M.shared) && t.includes(M.requester) && !t.includes(M.mspPrivate));
    await post('My organization only', M.customerPrivate); await shot('02-alice-view');

    await chapter('QA reloads: MSP-private visible, customer-private absent');
    await actor(actors.qa()); await openTask();
    await page.locator('li[id^=co-task-comment-]').filter({ hasText: M.mspPrivate }).waitFor({ timeout: 60000 });
    t = await body();
    await check('qa-sees-shared-requester-msp-private-not-customer-private', t.includes(M.shared) && t.includes(M.requester) && t.includes(M.mspPrivate) && !t.includes(M.customerPrivate));
    await shot('03-qa-view');

    await chapter('The client-portal requester sees only the requester message');
    const req = credential('cm-review-20261026-07-requester.json');
    await page.goto('about:blank'); await ctx.clearCookies();
    await page.goto(`${origin}/auth/client-portal/signin?tenant=${portalSlug(WR)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const b = document.querySelector('#client-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
    await page.locator('#client-email-field').fill(req.email); await page.waitForTimeout(800);
    await page.locator('#client-password-field').fill(req.password); await page.locator('#client-sign-in-button').click();
    const s = await until(async () => { const x = await ctx.request.get(origin + '/api/auth/session').then((r) => r.json()); return x.user?.email === req.email ? x : null; }, 'requester login');
    states.requester = { email: req.email, tenant: s.user.tenant }; await mark('Fresh client-portal form login', states.requester);
    await go(`/client-portal/projects/${PID}?taskId=${TID}`);
    const conv = page.locator('#requester-task-' + TID + '-conversation');
    await until(async () => await page.locator('#requester-task-' + TID + '-message').count() || await conv.count(), 'portal conversation', 60000);
    if (!await page.locator('#requester-task-' + TID + '-message').count()) await conv.click();
    await page.getByText(M.requester, { exact: true }).first().waitFor({ timeout: 60000 });
    t = await body();
    await check('requester-sees-only-requester-message', t.includes(M.requester) && !t.includes(M.shared) && !t.includes(M.mspPrivate) && !t.includes(M.customerPrivate));
    await shot('04-requester-portal');

    await chapter('Stored audiences: canonical customer task comments and the MSP-owned private store');
    const like = (m) => `%${m}%`;
    const canonical = json(`select ptc.task_comment_id, ptc.note::text like '${like(M.shared)}' as shared, ptc.note::text like '${like(M.requester)}' as requester, ptc.note::text like '${like(M.customerPrivate)}' as customer_private, ptc.note::text like '${like(M.mspPrivate)}' as msp_private, ptc.* from project_task_comments ptc where ptc.tenant='${WR}' and ptc.task_id='${TID}' and ptc.note::text like '%T09-2D00%${stamp}%'`);
    const mspStore = Number(sql(`select count(*) from co_management_private_comments where tenant='${OZ}' and note::text like '%${M.mspPrivate}%'`).trim() || 0);
    receipt('db-stored', { canonical, mspStoreCount: mspStore });
    await check('db-msp-private-only-in-msp-store', canonical.every((c) => !c.msp_private) && mspStore === 1, { canonicalCount: canonical.length, mspStore });
    await check('db-three-customer-owned-comments', canonical.length === 3, canonical.map((c) => ({ shared: c.shared, requester: c.requester, customer_private: c.customer_private })));

    await chapter('Cleanup: Alice removes the project grant');
    await actor(actors.alice()); await go('/msp/co-management');
    await page.locator('#co-policy-project-remove-' + PID).click(); await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
    await check('grant-removed', scope().length === 0, scope());
    return { status: 'passed', limitations: ['Messages are left in place as conversation history; the project grant is removed.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
