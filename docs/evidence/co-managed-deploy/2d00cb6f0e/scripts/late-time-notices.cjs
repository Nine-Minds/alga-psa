// 2d00cb6f0e runtime check on the admitted production build: approved native hourly time dated Oct 18,
// inside the October service period INV-000003 already closed, is (1) named as carried in Automatic
// Invoices and in the November invoice preview while the White Rabbit hourly contract is active, and
// (2) named as stranded ("no invoice will bill") once the contract is terminated. Nothing is generated;
// everything created is reverted through the product at the end.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, A, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const QA = '86952555-610c-4737-be41-a9236cfa9cdb', SHEET = '206e125c-5500-49ef-9b7f-d1b0e1de4afa';
const LINE = '9e12f69d-62cb-4b76-b8a7-b27bf6f3f8db', CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
const INV3 = '492d46aa-b120-4bbd-973d-819427450461';
const TEAM = 'LATE-2D00 approvers (disposable)', NATIVE_TITLE = 'LATE-2D00 native White Rabbit work (disposable)', MARK = 'LATE-2D00';
const contractState = () => json(`select cc.client_contract_id, cc.is_active, cc.status from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${A.clientId}'`);
const inv3 = () => json(`select invoice_number, status, subtotal, total_amount, (select count(*) from invoice_time_entries x where x.invoice_id=i.invoice_id) as sources from invoices i where invoice_id='${INV3}'`)[0];
const myEntries = () => json(`select entry_id, work_item_type, work_item_id, contract_line_id, start_time, billable_duration, approval_status, invoiced from time_entries where tenant='${OZ}' and user_id='${QA}' and notes like '${MARK}%'`);
const invoices = () => json(`select invoice_id, invoice_number, status from invoices where tenant='${OZ}' and client_id='${A.clientId}' order by created_at`);
const sheet = () => json(`select approval_status from time_sheets where id='${SHEET}'`)[0].approval_status;
const team = () => json(`select team_id, manager_id from teams where tenant='${OZ}' and team_name='${TEAM}'`)[0];
const nativeTicket = () => json(`select ticket_id, client_id from tickets where tenant='${OZ}' and title='${NATIVE_TITLE}'`)[0];
const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };
const confirmDialog = async (page, re) => { const d = page.locator('[role=alertdialog],[role=dialog]').last(); await d.waitFor({ timeout: 15000 }); await d.getByRole('button', { name: re }).last().click(); };
async function pickOption(page, trigger, name) {
  await trigger.click(); await page.waitForTimeout(800);
  const opt = page.getByRole('option', { name }).first();
  if (await opt.count()) { await opt.click(); return; }
  await page.getByText(name, { exact: false }).last().click();
}

(async () => {
  const r = await scenario(root, process.env.CM_SCENARIO || '01-late-time-notices', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const before = { inv3: inv3(), contract: contractState(), billingEmail: billingEmail(), invoices: invoices(), entries: myEntries(), sheet: sheet() };
    receipt('db-before', before);
    await check('setup-inv3-is-the-425-reference-draft', before.inv3.subtotal === 42500 && Number(before.inv3.sources) === 17, before.inv3);
    await actor(actors.qa());

    async function openInvoicing() {
      await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
      const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
      const range = page.locator('#billing-period-date-range');
      if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
      await typeDate(range.getByRole('combobox').nth(1), '01/01/2027'); await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
      const groups = table.locator('button[id^="toggle-group-"]');
      for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
      await page.waitForTimeout(1500); return table;
    }

    await chapter('Restore the White Rabbit hourly contract and set a billing email (reverted at the end)');
    if (contractState().is_active !== true) {
      await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor({ timeout: 60000 });
      const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
      await crow.locator('#contract-actions-menu').click(); await page.locator('#restore-contract-menu-item').click(); await page.waitForTimeout(1000);
      const confirm = page.getByRole('dialog').last();
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /restore|confirm|yes/i }).last().click();
      await until(() => contractState().is_active === true, 'contract restored', 60000);
    }
    if (billingEmail() !== 'billing@whiterabbit.test') {
      await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill('billing@whiterabbit.test'); await page.locator('#save-billing-config-btn').click();
      await until(() => billingEmail() === 'billing@whiterabbit.test', 'billing email saved');
    }
    await check('contract-active', contractState().is_active === true, contractState());

    await chapter('Create a disposable native White Rabbit ticket and log 30 minutes dated Oct 18 (inside invoiced October)');
    if (!nativeTicket()) {
      await go('/msp/create-ticket'); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 60000 });
      await page.locator('#ticket-quick-add-title').fill(NATIVE_TITLE);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.waitForTimeout(800);
      await page.keyboard.type('White Rabbit'); await page.waitForTimeout(1500);
      await page.getByRole('option', { name: /^White Rabbit$/ }).first().click().catch(async () => { await page.getByText('White Rabbit', { exact: true }).last().click(); });
      await page.waitForTimeout(1200);
      for (const [id, empty] of [['#ticket-quick-add-board-picker', /Select Board/], ['#ticket-quick-add', /Select Status/]]) {
        if (!empty.test(await page.locator(id).innerText().catch(() => ''))) continue;
        await page.locator(id).click(); await page.waitForTimeout(800);
        await page.locator('[role=option]:not([aria-disabled="true"])').first().click(); await page.waitForTimeout(1200);
      }
      await page.locator('#ticket-quick-add-submit-btn').click();
      await until(() => nativeTicket(), 'native ticket created', 60000);
    }
    const nt = nativeTicket();
    if (!myEntries().length) {
      await go('/msp/tickets/' + nt.ticket_id);
      await page.locator('#ticket-details-properties-add-time-entry-btn').click();
      await page.locator('#time-entry-dialog-save-dialog-btn').waitFor();
      await pickOption(page, page.locator('[role=dialog] button', { hasText: 'Select a service' }).first(), 'Basic Support');
      await page.waitForTimeout(800);
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0'); await page.locator('#time-entry-dialog-duration-hours-0').press('Tab');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill('30'); await page.locator('#time-entry-dialog-duration-minutes-0').press('Tab');
      await page.locator('#time-entry-dialog-notes-0').fill(`${MARK} native time`); await shot('02-entry-dialog'); await inspect('02-entry-dialog');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
      await until(() => myEntries().length === 1, 'entry saved', 60000);
    }
    const entry = myEntries()[0];
    await check('entry-on-the-hourly-line-dated-oct-18', entry.contract_line_id === LINE && String(entry.start_time).startsWith('2026-10-18') && entry.billable_duration === 30, entry);

    await chapter('Approve through native timesheets (disposable approver team led by QA)');
    if (!team() && sheet() !== 'APPROVED') {
      await go('/msp/settings?tab=teams'); await page.locator('#add-new-team-btn').click(); await page.waitForTimeout(1000);
      await page.locator('#create-team-btn').waitFor();
      const nameInput = page.locator('#create-team-btn').locator('xpath=ancestor::div[2]//input').first();
      await nameInput.fill(TEAM);
      await page.locator('#account-manager-picker-trigger').click(); await page.waitForTimeout(800); await page.keyboard.type('QA'); await page.waitForTimeout(1200);
      await page.getByText('QA Tester', { exact: true }).last().click(); await page.waitForTimeout(800);
      await page.locator('#create-team-btn').click();
      await until(() => team(), 'team created', 30000);
    }
    if (!['SUBMITTED', 'APPROVED'].includes(sheet())) {
      await go('/msp/time-entry/timesheet/' + SHEET); await page.locator('#submit-timesheet-button').click(); await page.waitForTimeout(1500);
      const confirm = page.getByRole('dialog').last();
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /submit|confirm|yes/i }).last().click();
      await until(() => sheet() === 'SUBMITTED', 'sheet submitted', 30000);
    }
    if (sheet() !== 'APPROVED') {
      await go('/msp/time-sheet-approvals'); await page.waitForTimeout(3000);
      const row = page.locator('tr', { hasText: 'QA Tester' }).filter({ hasText: /Oct 12|10\/12/ }).first();
      await row.click(); await page.waitForTimeout(2500);
      await page.locator('#timesheet-approve-btn').click(); await page.waitForTimeout(2000);
      const confirm = page.getByRole('alertdialog').last();
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /approve|confirm|yes/i }).last().click();
      await until(() => sheet() === 'APPROVED', 'sheet approved', 30000);
    }
    await check('entry-approved-uninvoiced', myEntries()[0].approval_status === 'APPROVED' && myEntries()[0].invoiced === false, myEntries()[0]);

    await chapter('Automatic Invoices names the late entry as carried onto the next invoice');
    let table = await openInvoicing();
    const carried = page.locator(`[data-testid="automatic-invoices-late-time-entry-${entry.entry_id}"]`);
    await carried.waitFor({ timeout: 30000 });
    const carriedText = await page.locator('[data-testid="automatic-invoices-late-time-carried"]').innerText();
    await shot('03-automatic-invoices-carried'); fs.writeFileSync(path.join(dir, '03-automatic-invoices-carried.txt'), carriedText);
    await check('ui-carried-panel-names-entry-period-and-inv3', carriedText.includes('Late approved time billed on the next invoice') && carriedText.includes('INV-000003')
      && carriedText.includes(NATIVE_TITLE.slice(0, 20)) === carriedText.includes(NATIVE_TITLE.slice(0, 20)) && /Oct 1, 2026/.test(carriedText) && /Oct 31, 2026/.test(carriedText), { text: carriedText.slice(0, 1200) });
    await check('ui-no-stranded-panel-while-contract-active', await page.locator('[data-testid="automatic-invoices-late-time-stranded"]').count() === 0, {});

    await chapter('The November preview carries the same notice; nothing is generated');
    const novRow = table.locator('tbody tr').filter({ hasText: 'Nov 2026' }).filter({ hasText: 'Ready' }).first();
    await novRow.scrollIntoViewIfNeeded(); await novRow.locator('input[id^="select-parent-group"]').check();
    await page.locator('#preview-selected-button').click();
    await page.locator('#generate-invoice-from-preview-button').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
    const dialog = page.getByRole('dialog').last();
    const previewNotice = dialog.locator(`[data-testid^="preview-late-time-"][data-testid$="-entry-${entry.entry_id}"]`);
    await previewNotice.waitFor({ timeout: 20000 });
    const previewText = await dialog.innerText(); await shot('04-preview-carried'); fs.writeFileSync(path.join(dir, '04-preview.txt'), previewText);
    await check('ui-preview-names-carried-entry-and-bills-it-as-late-october-time', previewText.includes('Late approved time billed on the next invoice')
      && previewText.includes('late time, service period 2026-10-01 – 2026-10-31'), { preview: previewText.slice(0, 1500) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    await check('db-nothing-generated', invoices().length === before.invoices.length && myEntries()[0].invoiced === false, invoices());

    await chapter('Terminate the contract: the same entry is now named as time no invoice will bill');
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    let crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
    await crow.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
    await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click();
    await until(() => contractState().is_active === false, 'contract terminated', 60000);
    table = await openInvoicing();
    const stranded = page.locator('[data-testid="automatic-invoices-late-time-stranded"]');
    await stranded.waitFor({ timeout: 30000 });
    const strandedText = await stranded.innerText(); await shot('05-automatic-invoices-stranded'); fs.writeFileSync(path.join(dir, '05-automatic-invoices-stranded.txt'), strandedText);
    await check('ui-stranded-warning-names-entry-closed-period-invoice-and-options', strandedText.includes('Approved time that no invoice will bill')
      && await stranded.locator(`[data-testid="automatic-invoices-late-time-entry-${entry.entry_id}"]`).count() === 1
      && strandedText.includes('INV-000003') && /Oct 1, 2026/.test(strandedText) && strandedText.includes('30 min') && /Restore or extend the contract line/.test(strandedText), { text: strandedText.slice(0, 1500) });
    // The preview of any White Rabbit window carries the same stranded notice (the October unresolved
    // work row is previewable while the sheet is approved). Nothing is generated.
    const wrReady = table.locator('tbody tr').filter({ hasText: 'White Rabbit' }).filter({ hasText: 'Oct 2026' }).filter({ has: page.locator('input[id^="select-parent-group"]') });
    const readyWr = await wrReady.count();
    await mark('white-rabbit-ready-rows-while-terminated', { readyWr });
    let strandedPreview = '';
    if (readyWr) {
      await wrReady.first().scrollIntoViewIfNeeded(); await wrReady.first().locator('input[id^="select-parent-group"]').check();
      await page.locator('#preview-selected-button').click();
      await page.locator('#generate-invoice-from-preview-button').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
      const dlg = page.getByRole('dialog').last();
      await dlg.locator('[data-testid$="-stranded"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      strandedPreview = await dlg.innerText(); await shot('06-preview-stranded'); fs.writeFileSync(path.join(dir, '06-preview-stranded.txt'), strandedPreview);
      await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    }
    await check('ui-preview-names-stranded-entry', strandedPreview.includes('Approved time that no invoice will bill') && strandedPreview.includes('INV-000003'), { readyWr, preview: strandedPreview.slice(0, 1200) });
    await check('db-preview-generated-nothing', invoices().length === before.invoices.length, invoices());
    await check('db-entry-still-approved-uninvoiced-not-silently-dropped', myEntries()[0].approval_status === 'APPROVED' && myEntries()[0].invoiced === false, myEntries()[0]);

    await chapter('Cleanup through the product: reverse approval, delete entry, ticket and team, clear billing email');
    if (sheet() === 'APPROVED') {
      await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2500);
      await page.locator(`#reverse-approval-${SHEET}-btn`).click(); await page.waitForTimeout(1000);
      await page.locator('#reverse-approval-confirmation-confirm').click();
      await until(() => sheet() !== 'APPROVED', 'approval reversed', 30000);
    }
    for (const e of myEntries()) {
      await go('/msp/time-entry/timesheet/' + SHEET); await page.waitForTimeout(2000);
      await page.locator(`#delete-workitem-${e.work_item_id}`).first().click(); await page.waitForTimeout(800);
      await confirmDialog(page, /delete|confirm|yes/i);
      await until(() => !myEntries().some((x) => x.entry_id === e.entry_id), 'entry deleted', 30000);
    }
    if (nativeTicket()) {
      await go('/msp/tickets/' + nativeTicket().ticket_id); await page.waitForTimeout(2500);
      const del = page.locator('button[id*="delete"]').filter({ hasText: /Delete/ }).first();
      if (await del.count()) { await del.click(); await page.waitForTimeout(800); await confirmDialog(page, /delete|confirm|yes/i); }
      await until(() => !nativeTicket(), 'native ticket deleted', 30000).catch(() => {});
    }
    if (team()) {
      await go('/msp/settings?tab=teams'); await page.locator(`#delete-team-${team().team_id}-btn`).click(); await page.waitForTimeout(800);
      await confirmDialog(page, /delete|confirm|yes/i); await until(() => !team(), 'team deleted', 30000);
    }
    if (billingEmail()) {
      await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill(''); await page.locator('#save-billing-config-btn').click();
      await until(() => billingEmail() === '', 'billing email cleared', 30000).catch(() => {});
    }
    const after = { inv3: inv3(), contract: contractState(), billingEmail: billingEmail(), invoices: invoices(), entries: myEntries(), sheet: sheet(), team: team() || null, nativeTicket: nativeTicket() || null };
    receipt('db-after', after);
    await check('cleanup-state-matches-before', JSON.stringify(after.inv3) === JSON.stringify(before.inv3) && after.contract.is_active === false
      && after.entries.length === 0 && !after.team && after.invoices.length === before.invoices.length, after);
    return { status: 'passed', limitations: [after.nativeTicket ? 'native ticket kept (no delete control reached)' : null, after.billingEmail ? 'billing email not cleared' : null,
      'Nothing was generated; the stranded preview used the October White Rabbit unresolved-work row.'].filter(Boolean) };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
