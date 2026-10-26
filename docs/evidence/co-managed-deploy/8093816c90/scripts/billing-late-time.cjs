// Task 1 runtime check on the admitted production build: approved hourly time dated inside the October
// service period that INV-000003 already closed is billed once on the line's next (November-service)
// invoice, alongside native work, without touching INV-000003. Everything created here is disposable and
// reverted at the end (draft reversed, entries deleted, team deleted, contract terminated, email cleared).
// Phases are idempotent: each checks the database first, so a rerun continues where a previous one stopped.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, A, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const QA = '86952555-610c-4737-be41-a9236cfa9cdb', SHEET = '206e125c-5500-49ef-9b7f-d1b0e1de4afa';
const LINE = '9e12f69d-62cb-4b76-b8a7-b27bf6f3f8db', CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
const INV3 = '492d46aa-b120-4bbd-973d-819427450461', OCT_RSP = 'b147a92b-5f45-4890-9422-bfbdd9650603', NOV_RSP = '649e776e-cc8f-4d80-be20-1eb5fe35a40e';
const WR = 'c64b2666-7dd6-4c61-8ced-4b233f628e61', REL = '2be5cb32-91e8-491a-9ec4-16ab019c7d40', SHARED_T = '81245210-accc-40ad-afaa-6680a85a75b0';
const TEAM = 'LATE-5A82 approvers (disposable)', NATIVE_TITLE = 'LATE-5A82 native White Rabbit work (disposable)';
const MARK = 'LATE-5A82';
const contractState = () => json(`select cc.client_contract_id, cc.is_active, cc.status from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${A.clientId}'`);
const inv3 = () => ({ invoice: json(`select invoice_number, status, subtotal, tax, total_amount from invoices where invoice_id='${INV3}'`)[0],
  charges: json(`select item_id, description, quantity, unit_price, net_amount from invoice_charges where invoice_id='${INV3}' order by item_id`),
  sources: json(`select entry_id from invoice_time_entries where invoice_id='${INV3}' order by entry_id`).map((r) => r.entry_id) });
const myEntries = () => json(`select entry_id, work_item_type, work_item_id, service_id, contract_line_id, start_time, billable_duration, approval_status, invoiced, time_sheet_id, notes from time_entries where tenant='${OZ}' and user_id='${QA}' and notes like '${MARK}%' order by start_time`);
const rsp = (id) => json(`select record_id, lifecycle_state, invoice_id from recurring_service_periods where record_id='${id}'`)[0];
const clientInvoices = () => json(`select invoice_id, invoice_number, status, subtotal, total_amount, created_at from invoices where tenant='${OZ}' and client_id='${A.clientId}' order by created_at`);
const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };

async function setEntry(page, service, minutes) {
  await pickOption(page, page.locator('[role=dialog] button', { hasText: 'Select a service' }).first(), service);
  await page.waitForTimeout(800);
  await page.locator('#time-entry-dialog-duration-hours-0').fill('0'); await page.locator('#time-entry-dialog-duration-hours-0').press('Tab');
  await page.locator('#time-entry-dialog-duration-minutes-0').fill(String(minutes)); await page.locator('#time-entry-dialog-duration-minutes-0').press('Tab');
  await page.waitForTimeout(800);
}
async function pickOption(page, trigger, name) {
  await trigger.click(); await page.waitForTimeout(800);
  const opt = page.getByRole('option', { name }).first();
  if (await opt.count()) { await opt.click(); return; }
  await page.getByText(name, { exact: false }).last().click();
}

(async () => {
  const r = await scenario(root, '01-billing-late-time', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const before = { inv3: inv3(), contract: contractState(), billingEmail: billingEmail(), octRsp: rsp(OCT_RSP), novRsp: rsp(NOV_RSP), invoices: clientInvoices(), entries: myEntries() };
    receipt('db-before', before);
    await check('setup-inv3-is-the-425-reference-draft', before.inv3.invoice.subtotal === 42500 && before.inv3.sources.length === 17, before.inv3.invoice);
    await check('setup-october-period-closed-by-inv3', before.octRsp.invoice_id === INV3 && before.novRsp.invoice_id === null, { oct: before.octRsp, nov: before.novRsp });
    await actor(actors.qa());

    await chapter('Restore the White Rabbit hourly contract and give the client a billing email (both reverted at the end)');
    if (contractState().is_active !== true) {
      await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor({ timeout: 60000 });
      const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
      await crow.locator('#contract-actions-menu').click(); await page.locator('#restore-contract-menu-item').click(); await page.waitForTimeout(1000);
      const confirm = page.getByRole('dialog').last();
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /restore|confirm|yes/i }).last().click();
      await until(() => contractState().is_active === true, 'contract restored', 60000);
    }
    await check('contract-active', contractState().is_active === true, contractState());
    if (billingEmail() !== 'billing@whiterabbit.test') {
      await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill('billing@whiterabbit.test'); await page.locator('#save-billing-config-btn').click();
      await until(() => billingEmail() === 'billing@whiterabbit.test', 'billing email saved');
    }

    await chapter('Log 30 minutes of MSP time on shared White Rabbit ticket 000016, dated Oct 18 (inside the invoiced October period)');
    if (!myEntries().some((e) => e.work_item_type === 'co_managed')) {
      await go(`/msp/co-management/tickets/${WR}/${REL}/${SHARED_T}`);
      await page.locator('#ticket-details-properties-add-time-entry-btn').click();
      await page.locator('#time-entry-dialog-save-dialog-btn').waitFor();
      await setEntry(page, 'Basic Support', 30);
      await page.locator('#time-entry-dialog-notes-0').fill(`${MARK} shared MSP time`); await shot('02-shared-entry-dialog'); await inspect('02-shared-entry-dialog');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
      await until(() => myEntries().some((e) => e.work_item_type === 'co_managed'), 'shared entry saved', 60000);
    }
    const shared = myEntries().find((e) => e.work_item_type === 'co_managed');
    await check('shared-entry-is-msp-commercial-time-on-the-contract-line-in-october', shared.contract_line_id === LINE && shared.billable_duration === 30
      && String(shared.start_time).startsWith('2026-10-18') && shared.time_sheet_id === SHEET, shared);

    await chapter('Create a native White Rabbit ticket and log 30 minutes of native time on it, also dated Oct 18');
    const nativeTicket = () => json(`select ticket_id, ticket_number, client_id from tickets where tenant='${OZ}' and title='${NATIVE_TITLE}'`)[0];
    if (!nativeTicket()) {
      await go('/msp/create-ticket'); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 60000 });
      await page.locator('#ticket-quick-add-title').fill(NATIVE_TITLE);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.waitForTimeout(800);
      await page.keyboard.type('White Rabbit'); await page.waitForTimeout(1500);
      await page.getByRole('option', { name: /^White Rabbit$/ }).first().click().catch(async () => { await page.getByText('White Rabbit', { exact: true }).last().click(); });
      await page.waitForTimeout(1200);
      for (const [id, empty] of [['#ticket-quick-add-board-picker', /Select Board/], ['#ticket-quick-add', /Select Status/]]) {
        if (!empty.test(await page.locator(id).innerText())) continue;
        await page.locator(id).click(); await page.waitForTimeout(800);
        await page.locator('[role=option]:not([aria-disabled="true"])').first().click(); await page.waitForTimeout(1200);
      }
      await shot('03-native-ticket-form'); await inspect('03-native-ticket-form');
      await page.locator('#ticket-quick-add-submit-btn').click();
      await until(() => nativeTicket(), 'native ticket created', 60000);
    }
    const nt = nativeTicket();
    await check('native-ticket-is-for-white-rabbit', nt.client_id === A.clientId, nt);
    if (!myEntries().some((e) => e.work_item_type === 'ticket')) {
      await go('/msp/tickets/' + nt.ticket_id);
      await page.locator('#ticket-details-properties-add-time-entry-btn').click();
      await page.locator('#time-entry-dialog-save-dialog-btn').waitFor();
      await setEntry(page, 'Basic Support', 30);
      await page.locator('#time-entry-dialog-notes-0').fill(`${MARK} native time`); await shot('04-native-entry-dialog');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
      await until(() => myEntries().some((e) => e.work_item_type === 'ticket'), 'native entry saved', 60000);
    }
    const native = myEntries().find((e) => e.work_item_type === 'ticket');
    await check('native-entry-on-the-same-contract-line-in-october', native.contract_line_id === LINE && native.billable_duration === 30
      && String(native.start_time).startsWith('2026-10-18') && native.work_item_id === nt.ticket_id, native);

    await chapter('Approve through native timesheets: a disposable approver team led by QA, submit the Oct 12-18 sheet, approve it');
    const team = () => json(`select team_id, manager_id from teams where tenant='${OZ}' and team_name='${TEAM}'`)[0];
    const sheet = () => json(`select approval_status from time_sheets where id='${SHEET}'`)[0].approval_status;
    if (!team() && sheet() !== 'APPROVED') {
      await go('/msp/settings?tab=teams'); await page.locator('#add-new-team-btn').click(); await page.waitForTimeout(1000);
      await page.locator('#create-team-btn').waitFor();
      await page.locator('input[placeholder]').filter({ hasNot: page.locator('[type=search]') }).last().fill(TEAM).catch(() => {});
      const nameInput = page.locator('#create-team-btn').locator('xpath=ancestor::div[1]/preceding-sibling::*//input | ancestor::div[2]//input').first();
      if (!(await nameInput.inputValue().catch(() => ''))) await nameInput.fill(TEAM);
      await page.locator('#account-manager-picker-trigger').click(); await page.waitForTimeout(800); await page.keyboard.type('QA'); await page.waitForTimeout(1200);
      await page.getByText('QA Tester', { exact: true }).last().click(); await page.waitForTimeout(800);
      await shot('05-team-form'); await inspect('05-team-form');
      await page.locator('#create-team-btn').click();
      await until(() => team(), 'team created', 30000);
    }
    if (sheet() !== 'APPROVED') await check('team-led-by-qa', team()?.manager_id === QA, team());
    if (!['SUBMITTED', 'APPROVED'].includes(sheet())) {
      await go('/msp/time-entry/timesheet/' + SHEET); await page.locator('#submit-timesheet-button').click(); await page.waitForTimeout(1500);
      const confirm = page.getByRole('dialog').last();
      if (await confirm.isVisible().catch(() => false)) { await inspect('06-submit-dialog'); await confirm.getByRole('button', { name: /submit|confirm|yes/i }).last().click(); }
      await until(() => sheet() === 'SUBMITTED', 'sheet submitted', 30000);
    }
    if (sheet() !== 'APPROVED') {
      await go('/msp/time-sheet-approvals'); await page.waitForTimeout(3000); await shot('07-approvals'); await inspect('07-approvals');
      const row = page.locator('tr', { hasText: 'QA Tester' }).filter({ hasText: /Oct 12|10\/12/ }).first();
      await row.click(); await page.waitForTimeout(2500);
      await shot('07b-approval-detail'); await page.locator('#timesheet-approve-btn').click(); await page.waitForTimeout(2000);
      const confirm = page.getByRole('alertdialog').last();
      if (await confirm.isVisible().catch(() => false)) { await inspect('07c-approve-confirm'); await confirm.getByRole('button', { name: /approve|confirm|yes/i }).last().click(); }
      await until(() => sheet() === 'APPROVED', 'sheet approved', 30000);
    }
    await check('both-entries-approved-uninvoiced', myEntries().length === 2 && myEntries().every((e) => e.approval_status === 'APPROVED' && e.invoiced === false), myEntries());

    await chapter('Automatic Invoices: the November service period of the hourly line now carries the late October time');
    await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
    const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
    const range = page.locator('#billing-period-date-range');
    if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
    await typeDate(range.getByRole('combobox').nth(1), '01/01/2027'); await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
    const groups = table.locator('button[id^="toggle-group-"]');
    for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
    await page.waitForTimeout(1500); await shot('08-automatic-invoices'); await inspect('08-automatic-invoices');
    const usd = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
    const novRow = table.locator('tbody tr').filter({ hasText: 'Nov 2026' }).filter({ hasText: 'Ready' }).first();
    const newInvoice = () => clientInvoices().find((i) => i.invoice_id !== INV3 && json(`select 1 from invoice_time_entries where invoice_id='${i.invoice_id}'`).length > 0);
    if (!newInvoice()) {
      await novRow.scrollIntoViewIfNeeded(); await novRow.locator('input[id^="select-parent-group"]').check();
      await page.locator('#preview-selected-button').click();
      await page.locator('#generate-invoice-from-preview-button').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
      const previewText = await page.getByRole('dialog').last().innerText(); await shot('09-preview'); fs.writeFileSync(path.join(dir, '09-preview.txt'), previewText);
      await check('preview-labels-both-entries-as-late-october-time-at-the-contract-rate',
        (previewText.match(/late time, service period 2026-10-01 – 2026-10-31/g) || []).length >= 2 && previewText.includes(usd(10000)) && previewText.includes(usd(5000)), { preview: previewText.slice(0, 1500) });
      await page.locator('#generate-invoice-from-preview-button').click();
      await until(newInvoice, 'disposable draft generated', 120000);
    }
    const inv = newInvoice();
    const ch = json(`select ic.item_id, ic.description, ic.quantity, ic.unit_price, ic.net_amount, d.service_period_start, d.service_period_end from invoice_charges ic left join invoice_charge_details d on d.tenant=ic.tenant and d.item_id=ic.item_id where ic.invoice_id='${inv.invoice_id}' order by ic.description`);
    const links = json(`select entry_id, work_item_snapshot from invoice_time_entries where invoice_id='${inv.invoice_id}' order by entry_id`);
    receipt('db-new-invoice', { invoice: inv, charges: ch, links, entries: myEntries(), octRsp: rsp(OCT_RSP), novRsp: rsp(NOV_RSP) });
    await check('db-disposable-draft-bills-exactly-the-two-late-entries-at-100-per-hour', Number(inv.subtotal) === 10000 && links.length === 2
      && links.map((l) => l.entry_id).sort().join() === myEntries().map((e) => e.entry_id).sort().join(), { invoice: inv, links: links.map((l) => l.entry_id) });
    await check('db-lines-name-and-carry-the-october-service-period', ch.length === 2 && ch.every((c) => c.description.includes('late time, service period 2026-10-01 – 2026-10-31')
      && String(c.service_period_start).startsWith('2026-10-01') && Number(c.net_amount) === 5000 && Number(c.unit_price) === 10000), ch);
    await check('db-shared-line-keeps-qualified-co-managed-provenance', links.some((l) => l.work_item_snapshot?.sourceTenant === WR && l.work_item_snapshot?.relationshipId === REL)
      && links.some((l) => l.work_item_snapshot?.workItemType === 'ticket' && !l.work_item_snapshot?.sourceTenant), links.map((l) => l.work_item_snapshot));
    await check('db-periods-october-stays-on-inv3-november-claimed-by-the-new-draft', rsp(OCT_RSP).invoice_id === INV3 && rsp(NOV_RSP).invoice_id === inv.invoice_id, { oct: rsp(OCT_RSP), nov: rsp(NOV_RSP) });
    await check('db-inv3-unchanged', JSON.stringify(inv3()) === JSON.stringify(before.inv3), inv3().invoice);
    await check('db-entries-invoiced-once', myEntries().every((e) => e.invoiced) && myEntries().every((e) => Number(sql(`select count(*) from invoice_time_entries where entry_id='${e.entry_id}'`)) === 1), {});

    await chapter('Open the disposable draft: both lines say which October period they belong to');
    await go('/msp/invoices/' + inv.invoice_id); await page.waitForTimeout(3500);
    const invText = await page.locator('main').innerText(); await shot('10-new-draft'); fs.writeFileSync(path.join(dir, '10-new-draft.txt'), invText);
    await check('ui-draft-shows-late-lines-and-100', invText.includes(inv.invoice_number) && invText.includes('late time, service period 2026-10-01') && invText.includes(usd(10000)), { number: inv.invoice_number });

    await chapter('Retry: nothing is offered twice, and the closed October window cannot be regenerated');
    await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
    if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
    await typeDate(range.getByRole('combobox').nth(1), '01/01/2027'); await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
    for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
    await page.waitForTimeout(1500); await shot('11-after-generation'); const afterText = await table.innerText(); fs.writeFileSync(path.join(dir, '11-after-generation.txt'), afterText);
    await check('no-ready-november-row-after-generation', !/Nov 2026[\s\S]{0,40}Ready|Ready[\s\S]{0,40}Nov 2026/.test(afterText), { rows: afterText.slice(0, 800) });
    await check('db-still-one-new-draft-and-inv3-unchanged', clientInvoices().filter((i) => i.invoice_id !== INV3).length === before.invoices.filter((i) => i.invoice_id !== INV3).length + 1
      && JSON.stringify(inv3()) === JSON.stringify(before.inv3), clientInvoices());
    return { status: 'partial', limitations: ['cleanup not yet run'], invoiceId: inv.invoice_id };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
