// Reverts everything 01-billing-late-time created, through the product: reverse disposable draft INV-000005,
// reverse the sheet approval, delete the two LATE-5A82 entries and the native ticket, delete the disposable
// team, terminate the contract again and clear the billing email. INV-000003 is checked unchanged.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, A, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const QA = '86952555-610c-4737-be41-a9236cfa9cdb', SHEET = '206e125c-5500-49ef-9b7f-d1b0e1de4afa', CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
const INV3 = '492d46aa-b120-4bbd-973d-819427450461', NOV_RSP = '649e776e-cc8f-4d80-be20-1eb5fe35a40e';
const TEAM = 'LATE-5A82 approvers (disposable)', NATIVE_TITLE = 'LATE-5A82 native White Rabbit work (disposable)', MARK = 'LATE-5A82';
const myEntries = () => json(`select entry_id, work_item_type, work_item_id, approval_status, invoiced from time_entries where tenant='${OZ}' and user_id='${QA}' and notes like '${MARK}%'`);
const disposable = () => json(`select invoice_id, invoice_number, status from invoices where tenant='${OZ}' and client_id='${A.clientId}' and invoice_id<>'${INV3}'`);
const sheet = () => json(`select approval_status from time_sheets where id='${SHEET}'`)[0].approval_status;
const team = () => json(`select team_id from teams where tenant='${OZ}' and team_name='${TEAM}'`)[0];
const nativeTicket = () => json(`select ticket_id from tickets where tenant='${OZ}' and title='${NATIVE_TITLE}'`)[0];
const contractState = () => json(`select cc.is_active, cc.status from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${A.clientId}'`);
const inv3 = () => json(`select invoice_number, status, subtotal, total_amount, (select count(*) from invoice_time_entries x where x.invoice_id=i.invoice_id) as sources from invoices i where invoice_id='${INV3}'`)[0];
const confirmDialog = async (page, re) => { const d = page.locator('[role=alertdialog],[role=dialog]').last(); await d.waitFor({ timeout: 15000 }); await d.getByRole('button', { name: re }).last().click(); };

(async () => {
  const r = await scenario(root, '02-billing-late-time-cleanup', async ({ page, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    receipt('db-before', { disposable: disposable(), entries: myEntries(), sheet: sheet(), team: team(), nativeTicket: nativeTicket(), contract: contractState(), billingEmail: billingEmail(), inv3: inv3() });
    await actor(actors.qa());
    await chapter('Reverse the disposable draft INV-000005');
    for (const inv of disposable().filter((i) => i.status === 'draft')) {
      await go('/msp/invoices/' + inv.invoice_id); await page.locator('#invoice-reverse-draft-button').click(); await page.waitForTimeout(1000);
      await inspect('01-reverse-dialog'); await confirmDialog(page, /reverse|confirm|yes/i);
      await until(() => !disposable().some((i) => i.invoice_id === inv.invoice_id && i.status === 'draft'), 'draft reversed', 90000);
    }
    await check('draft-reversed-entries-and-november-period-released', myEntries().every((e) => !e.invoiced)
      && json(`select invoice_id from recurring_service_periods where record_id='${NOV_RSP}'`)[0].invoice_id === null, { entries: myEntries(), disposable: disposable() });
    await chapter('Reverse the timesheet approval');
    if (sheet() === 'APPROVED') {
      await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2500);
      await page.locator(`#reverse-approval-${SHEET}-btn`).click(); await page.waitForTimeout(1000);
      await page.locator('#reverse-approval-confirmation-confirm').click();
      await until(() => sheet() !== 'APPROVED', 'approval reversed', 30000);
    }
    await chapter('Delete the two disposable entries from the timesheet');
    for (const e of myEntries()) {
      await go('/msp/time-entry/timesheet/' + SHEET); await page.waitForTimeout(2000);
      await page.locator(`#delete-workitem-${e.work_item_id}`).first().click(); await page.waitForTimeout(800);
      await confirmDialog(page, /delete|confirm|yes/i);
      await until(() => !myEntries().some((x) => x.entry_id === e.entry_id), 'entry deleted ' + e.entry_id, 30000);
    }
    await check('entries-deleted', myEntries().length === 0, {});
    await chapter('Delete the disposable native ticket and approver team');
    if (nativeTicket()) {
      await go('/msp/tickets/' + nativeTicket().ticket_id); await page.waitForTimeout(2500); await inspect('03-native-ticket');
      const del = page.locator('button[id*="delete"]').filter({ hasText: /Delete/ }).first();
      if (await del.count()) { await del.click(); await page.waitForTimeout(800); await confirmDialog(page, /delete|confirm|yes/i); }
      await until(() => !nativeTicket(), 'native ticket deleted', 30000).catch(() => {});
    }
    if (team()) {
      await go('/msp/settings?tab=teams'); await page.locator(`#delete-team-${team().team_id}-btn`).click(); await page.waitForTimeout(800);
      await confirmDialog(page, /delete|confirm|yes/i); await until(() => !team(), 'team deleted', 30000);
    }
    await chapter('Terminate the contract again and clear the billing email');
    if (contractState().is_active) {
      await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
      const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
      await crow.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
      await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click();
      await until(() => contractState().is_active === false, 'contract terminated', 60000);
    }
    if (billingEmail()) {
      await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill(''); await page.locator('#save-billing-config-btn').click();
      await until(() => billingEmail() === '', 'billing email cleared', 30000).catch(() => {});
    }
    const after = { disposable: disposable(), entries: myEntries(), sheet: sheet(), team: team(), nativeTicket: nativeTicket(), contract: contractState(), billingEmail: billingEmail(), inv3: inv3() };
    receipt('db-after', after);
    await check('inv3-unchanged-425-17-sources', after.inv3.subtotal === 42500 && Number(after.inv3.sources) === 17 && after.inv3.status === 'draft', after.inv3);
    const leftovers = [!after.nativeTicket ? null : 'native ticket kept (no delete control reached)', after.billingEmail ? 'billing email not cleared' : null].filter(Boolean);
    return { status: 'passed', limitations: leftovers };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
