// T13: a qualified MSP edit on a shared customer ticket carries the MSP actor's qualified attribution in the
// customer's audit trail and history, never a customer user id. QA changes the priority of White Rabbit ticket
// 000016 from the shared ticket page; Alice reads the history in her workspace; QA restores the priority.
const fs = require('fs'), path = require('path');
const { scenario, until } = require('./runtime.cjs');
const { actors, json } = require('./common.cjs');
const root = process.env.CM_ROOT;
const WR = 'c64b2666-7dd6-4c61-8ced-4b233f628e61', REL = '2be5cb32-91e8-491a-9ec4-16ab019c7d40', T = '81245210-accc-40ad-afaa-6680a85a75b0';
const prio = () => json(`select p.priority_name from tickets t join priorities p on p.tenant=t.tenant and p.priority_id=t.priority_id where t.tenant='${WR}' and t.ticket_id='${T}'`)[0].priority_name;
const audits = (since) => json(`select audit_id, event_type, actor_type, actor_user_id, actor_contact_id, actor_reference_id, actor_display_name, actor_organization_name, source, changes from ticket_audit_logs where tenant='${WR}' and ticket_id='${T}' and occurred_at > '${since}' order by occurred_at`);
(async () => {
  const r = await scenario(root, '03-t13-msp-edit-attribution', async ({ page, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const since = new Date().toISOString(); const original = prio();
    await actor(actors.qa());
    await chapter('QA (Oz MSP) changes the priority of shared White Rabbit ticket 000016');
    await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`);
    const trigger = page.locator('[data-automation-id="ticket-details-info"] button', { hasText: new RegExp('^' + original + '$') }).first(); await trigger.click(); await page.waitForTimeout(800);
    const choice = page.locator('[role=option]:not([aria-disabled="true"])').filter({ hasNotText: new RegExp('^' + original + '$') }).first();
    const target = (await choice.innerText()).trim(); await choice.click(); await page.waitForTimeout(600);
    await page.locator('#ticket-details-info-save-changes-btn').click();
    await until(() => prio() === target, 'priority saved', 30000);
    const rows = audits(since); receipt('audit-after-qa-edit', rows);
    const row = rows.find((a) => JSON.stringify(a.changes).toLowerCase().includes('priority')) ?? rows[rows.length - 1];
    await check('customer-audit-row-carries-qualified-msp-actor', row && row.actor_reference_id && !row.actor_user_id && !row.actor_contact_id
      && /QA Tester/.test(row.actor_display_name) && row.actor_organization_name, row);
    await chapter('Alice (White Rabbit IT) reads the ticket history in her own workspace');
    await actor(actors.alice()); await go('/msp/tickets/' + T);
    await page.locator('#ticket-layout-toggle-grid').click().catch(() => {}); await page.waitForTimeout(2500);
    const hist = page.locator('#co-ticket-history-open, [id*="history"]').first();
    if (await hist.count()) { await hist.click().catch(() => {}); await page.waitForTimeout(2500); }
    const text = await page.locator('body').innerText(); fs.writeFileSync(path.join(dir, '02-alice-history.txt'), text); await shot('02-alice-history');
    const qualifiedName = `${row.actor_display_name} (${row.actor_organization_name})`;
    const line = `${qualifiedName} changed priority: ${original} → ${target}`;
    await check('alice-history-names-the-qualified-msp-actor-for-the-change', text.includes(line), { line });
    await chapter('QA restores the original priority');
    await actor(actors.qa()); await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`);
    await page.locator('[data-automation-id="ticket-details-info"] button', { hasText: new RegExp('^' + target + '$') }).first().click(); await page.waitForTimeout(800);
    await page.locator('[role=option]', { hasText: new RegExp('^' + original + '$') }).first().click(); await page.waitForTimeout(600);
    await page.locator('#ticket-details-info-save-changes-btn').click(); await until(() => prio() === original, 'priority restored', 30000);
    receipt('audit-all', audits(since));
    await check('priority-restored', prio() === original, { original });
    return { status: 'passed' };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
