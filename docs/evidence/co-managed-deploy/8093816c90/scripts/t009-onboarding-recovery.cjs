// clientIntegration:T009 (and the work order's "durable email delivery recovery"): a fixed-client setup on a
// disposable client whose only history is cancelled setups. With the local SMTP sink rejecting mail the
// administrator invitation fails; the client view reports delivery failure (also after a reload) with Retry.
// After the sink recovers, Retry delivers exactly one invitation. Then the invitation's expiry (moved into the
// past with a recorded SQL time fixture) is reported as expiry, distinct from delivery failure, with Resend.
// The setup is cancelled at the end so its seat is released.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, sink, mailsTo } = require('./common.cjs');
const root = process.env.CM_ROOT;
const OZ = 'fa7f912f-6b62-463e-85cc-ffedab47ac44', CLIENT = '9e24700a-3cf0-45d0-bc6c-4dfb15e9b52f';
const S = String(Date.now()).slice(-6), WS = `T009-${S} IT`, EMAIL = `t009-${S}@cmreview.test`;
const P = 'client-details-co-managed';
const control = (fault, action, body) => fetch(`http://127.0.0.1:9177/control/smtp-sink/faults/${fault}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const op = () => json(`select operation_id, state, step, error_code, invitation_sent_at, invitation_delivery_error, customer_tenant, relationship_id, administrator_invitation_id from co_managed_provisioning_operations where tenant='${OZ}' and request->>'workspaceName'='${WS}'`)[0];
const allocation = (o) => json(`select seats, state from co_managed_allocations where operation_id='${o.operation_id}'`)[0];
(async () => {
  const r = await scenario(root, '07-t009-onboarding-recovery', async ({ page, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const body = () => page.locator('body').innerText();
    try {
      await chapter('QA opens a client whose only history is cancelled setups; the local mail sink is set to reject mail');
      await actor(actors.qa()); await (await control('reject-mail', 'arm', { code: 550 })).text();
      await go(`/msp/clients/${CLIENT}?tab=co-managed`); await page.locator(`#${P}-workspace-name`).waitFor({ timeout: 60000 });
      await page.locator(`#${P}-workspace-name`).fill(WS);
      await page.locator(`#${P}-admin-firstName`).fill('T009'); await page.locator(`#${P}-admin-lastName`).fill('Admin'); await page.locator(`#${P}-admin-email`).fill(EMAIL);
      await page.locator(`#${P}-seats`).fill('1');
      const board = page.locator(`#${P}-escalation-board`);
      if (/Select/i.test(await board.innerText())) { await board.click(); await page.locator('[role=option]:not([aria-disabled="true"])').first().click(); }
      await shot('01-setup-form'); await page.locator(`#${P}-setup-submit`).click();
      await page.waitForTimeout(1500); const progressText = await body(); await shot('01b-reserved-progress');
      const reserved = await until(() => { const o = op(); return o ? { o, a: allocation(o) } : null; }, 'operation created', 60000);
      receipt('db-reserved', reserved);
      await check('setup-shows-progress-with-a-reserved-seat', /Setup progress|Provisioning|queued|Setting up/i.test(progressText) && reserved.a?.state === 'reserved' && reserved.a?.seats === 1, { allocation: reserved.a, state: reserved.o.state });
      await chapter('Provisioning runs; the invitation cannot be delivered');
      const failed = await until(() => { const o = op(); return o && o.invitation_delivery_error ? o : null; }, 'delivery failure recorded', 240000);
      receipt('db-delivery-failed', { operation: failed, allocation: allocation(failed) });
      await go(`/msp/clients/${CLIENT}?tab=co-managed`); await page.waitForTimeout(3000); const t1 = await body(); await shot('02-delivery-failed-after-reload');
      await check('reload-reopens-the-same-setup-showing-delivery-failure-not-expiry', /could not be delivered|Delivery failed/i.test(t1) && !/Invitation expired/i.test(t1) && await page.locator(`#${P}-recovery-retry`).count() === 1, { state: failed.state });
      await chapter('The mail sink recovers; Retry delivers the original invitation once');
      await (await control('reject-mail', 'disarm')).text();
      const before = mailsTo(await sink(), EMAIL).length;
      const origin0 = await page.evaluate(() => performance.timeOrigin);
      const summaryBefore = await page.locator('#client-details-co-managed-summary').innerText().catch(() => '');
      // Durable delivery may recover on its own once mail flows again; only press Retry if it has not.
      const auto = await until(() => { const o = op(); return o && o.invitation_sent_at && !o.invitation_delivery_error ? o : null; }, 'automatic recovery', 120000).catch(() => null);
      if (!auto) await page.locator(`#${P}-recovery-retry`).click();
      const sent = await until(() => { const o = op(); return o && o.invitation_sent_at && !o.invitation_delivery_error ? o : null; }, 'invitation delivered', 180000);
      receipt('recovery-path', { automatic: Boolean(auto), retryPressed: !auto });
      await until(async () => mailsTo(await sink(), EMAIL).length > before, 'mail in sink', 60000);
      await page.waitForTimeout(3000);
      const summaryAfter = await page.locator('#client-details-co-managed-summary').innerText().catch(() => '');
      const viewAfter = await body(); const sameDocument = origin0 === await page.evaluate(() => performance.timeOrigin);
      const mails = mailsTo(await sink(), EMAIL); receipt('db-delivered', { operation: sent, mailsToAdministrator: mails.length, subjects: mails.map((m) => m.subject), summaryBefore, summaryAfter, sameDocument });
      await check('recovery-refreshes-the-view-in-the-same-document', sameDocument && !/could not be delivered/i.test(viewAfter), { summaryBefore, summaryAfter });
      await go(`/msp/clients/${CLIENT}?tab=co-managed`); await page.waitForTimeout(3000); const t2 = await body(); await shot('03-delivered');
      await check('retry-recovers-one-operation-and-one-delivery', sent.operation_id === failed.operation_id && mails.length === 1 && !/could not be delivered/i.test(t2), { operationId: sent.operation_id, mails: mails.length });
      await chapter('Expiry (time fixture): the invitation is reported expired, distinct from delivery failure, with Resend');
      sql(`update user_invitations set expires_at = now() - interval '1 hour' where tenant='${sent.customer_tenant}' and invitation_id='${sent.administrator_invitation_id}'`);
      await go(`/msp/clients/${CLIENT}?tab=co-managed`); await page.waitForTimeout(3000); const t3 = await body(); await shot('04-expired');
      const resend = await page.locator(`#${P}-recovery-retry`).innerText().catch(() => '');
      receipt('expired', { resendLabel: resend });
      await check('expiry-is-named-and-offers-resend', /Invitation expired/i.test(t3) && !/could not be delivered/i.test(t3) && /Resend/i.test(resend), { resend });
      return { status: 'passed', limitations: ['Invitation expiry was produced by moving expires_at into the past (recorded SQL time fixture); delivery failure used the local SMTP sink reject-mail fault.'] };
    } finally {
      await control('reject-mail', 'disarm').catch(() => {});
      await chapter('Cancel the disposable setup and release its seat');
      try {
        await go(`/msp/clients/${CLIENT}?tab=co-managed`); await page.waitForTimeout(2500);
        if (await page.locator(`#${P}-recovery-cancel`).count()) { await page.locator(`#${P}-recovery-cancel`).click(); await page.locator(`#${P}-recovery-cancel-confirm-button`).click(); }
        const o = op(); if (o) await until(() => op().state === 'cancelled', 'setup cancelled', 120000).catch(() => {});
        const final = op(); receipt('db-after-cancel', { operation: final, allocation: final ? allocation(final) : null }); await shot('05-cancelled');
      } catch (e) { receipt('cleanup-error', { message: e.message }); }
    }
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
