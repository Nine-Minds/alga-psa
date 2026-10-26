// 2d00cb6f0e decision check on the admitted production build: a draft closes its window (late time is
// carried and named), and reversing the draft reopens it, so the late time rebills with the regenerated
// window and is not carried as late time. Disposable client "CM-REVIEW-20261026-01 Cancel-3" gets a
// disposable hourly contract through the wizard; QA logs the on-time entry; Glinda (a second technician)
// logs the entry approved after the draft exists. Everything is reverted through the product at the end.
const fs = require('fs'), path = require('path');
const { scenario, sql, until, credential } = require('./runtime.cjs');
const { actors, json, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const QA = '86952555-610c-4737-be41-a9236cfa9cdb', GLINDA = '5e32d7f7-67f4-4628-a5ee-132ebb5bfa59', QA_SHEET = '206e125c-5500-49ef-9b7f-d1b0e1de4afa';
const CLIENT = 'a67a50b5-6689-479b-9ef8-9072e993c175', CLIENT_NAME = 'CM-REVIEW-20261026-01 Cancel-3';
const CONTRACT = 'LATE-2D00 reopen contract (disposable)', TITLE = 'LATE-2D00 reopen ticket (disposable)', MARK = 'LATE-2D00-REOPEN';
const TEAM = 'LATE-2D00 reopen approvers (disposable)';
const glinda = () => ({ name: 'glinda', ...credential('glinda-dev-login.json') });
const contract = () => json(`select cc.client_contract_id, cc.is_active, cl.contract_line_id from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id join contract_lines cl on cl.tenant=c.tenant and cl.contract_id=c.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const ticket = () => json(`select ticket_id from tickets where tenant='${OZ}' and title='${TITLE}'`)[0];
const entries = () => json(`select entry_id, user_id, work_item_id, contract_line_id, start_time, billable_duration, approval_status, invoiced, time_sheet_id from time_entries where tenant='${OZ}' and notes like '${MARK}%' order by user_id`);
const invoices = () => json(`select invoice_id, invoice_number, status, subtotal from invoices where tenant='${OZ}' and client_id='${CLIENT}' order by created_at`);
const sheet = (id) => json(`select approval_status from time_sheets where id='${id}'`)[0]?.approval_status;
const team = () => json(`select team_id from teams where tenant='${OZ}' and team_name='${TEAM}'`)[0];
const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${CLIENT}'`);
const lines = (invoiceId) => json(`select ite.entry_id, ic.description from invoice_time_entries ite join invoice_charges ic on ic.tenant=ite.tenant and ic.item_id=ite.item_id where ite.invoice_id='${invoiceId}'`);
const typeDate = async (page, sel, v) => { const l = page.locator(sel); await l.click(); await l.press('Control+A'); await l.pressSequentially(v); await l.press('Tab'); };
const confirmDialog = async (page, re) => { const d = page.locator('[role=alertdialog],[role=dialog]').last(); await d.waitFor({ timeout: 15000 }); await d.getByRole('button', { name: re }).last().click(); };

(async () => {
  const r = await scenario(root, process.env.CM_SCENARIO || '02-reversed-draft-reopens', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    receipt('db-before', { contract: contract() || null, invoices: invoices(), entries: entries(), qaSheet: sheet(QA_SHEET), billingEmail: billingEmail() });
    const addTime = async (minutes) => {
      await go('/msp/tickets/' + ticket().ticket_id); await page.locator('#ticket-layout-toggle-entry').click().catch(() => {}); await page.waitForTimeout(1500);
      await page.locator('#ticket-details-properties-add-time-entry-btn').click();
      await page.locator('#time-entry-dialog-save-dialog-btn').waitFor();
      const svc = page.locator('[role=dialog] button', { hasText: 'Select a service' }).first(); await svc.click(); await page.waitForTimeout(800);
      await page.getByRole('option', { name: 'Basic Support' }).first().click().catch(async () => page.getByText('Basic Support').last().click());
      await page.waitForTimeout(800);
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0'); await page.locator('#time-entry-dialog-duration-hours-0').press('Tab');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill(String(minutes)); await page.locator('#time-entry-dialog-duration-minutes-0').press('Tab');
      await page.locator('#time-entry-dialog-notes-0').fill(`${MARK} ${minutes} min`); await page.locator('#time-entry-dialog-save-dialog-btn').click();
    };
    const openInvoicing = async () => {
      await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
      const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
      const range = page.locator('#billing-period-date-range');
      if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
      const end = range.getByRole('combobox').nth(1); await end.click(); await end.press('Control+A'); await end.pressSequentially('01/01/2027'); await end.press('Tab');
      await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
      const groups = table.locator('button[id^="toggle-group-"]');
      for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
      await page.waitForTimeout(1500); return table;
    };
    const generateOctober = async (label) => {
      const table = await openInvoicing();
      const row = table.locator('tbody tr').filter({ hasText: CONTRACT.slice(0, 20) }).filter({ hasText: 'Oct 2026' }).filter({ hasText: 'Ready' }).first();
      await row.scrollIntoViewIfNeeded(); await row.locator('input[id^="select-parent-group"]').check();
      await page.locator('#preview-selected-button').click(); await page.locator('#generate-invoice-from-preview-button').waitFor({ timeout: 60000 });
      await page.waitForTimeout(1200); await shot(label + '-preview'); fs.writeFileSync(path.join(dir, label + '-preview.txt'), await page.getByRole('dialog').last().innerText());
      const count = invoices().filter((i) => i.status === 'draft').length;
      await page.locator('#generate-invoice-from-preview-button').click();
      await until(() => invoices().filter((i) => i.status === 'draft').length > count, 'draft generated', 120000);
      return invoices().filter((i) => i.status === 'draft').slice(-1)[0];
    };
    const reverseDraft = async (inv) => {
      await go('/msp/invoices/' + inv.invoice_id); await page.locator('#invoice-reverse-draft-button').click(); await page.waitForTimeout(1000);
      await confirmDialog(page, /reverse|confirm|yes/i);
      await until(() => !invoices().some((i) => i.invoice_id === inv.invoice_id), 'draft reversed', 90000);
    };

    await chapter('QA creates a disposable hourly contract for Cancel-3 through the contract wizard (October start)');
    await actor(actors.qa());
    if (!contract()) {
      await go('/msp/billing?tab=client-contracts'); await page.locator('#client-wizard-button').click();
      await page.locator('#contract-basics-client-picker-trigger').click(); await page.keyboard.type('Cancel-3'); await page.waitForTimeout(1200);
      await page.getByRole('option', { name: new RegExp(CLIENT_NAME) }).first().click().catch(async () => { await page.getByText(CLIENT_NAME, { exact: true }).last().click(); });
      await page.locator('#contract_name').fill(CONTRACT);
      await typeDate(page, '#start-date', '10/01/2026'); await shot('01-contract-basics');
      await page.locator('#wizard-next').click(); await page.waitForTimeout(1200);
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1200);
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1200);
      await page.locator('#add-hourly-service-button').click(); await page.locator('button#hourly-service-0').click(); await page.waitForTimeout(1000);
      await page.getByRole('option', { name: /Basic Support/ }).first().click().catch(async () => { await page.getByText('Basic Support', { exact: true }).last().click(); });
      await page.waitForTimeout(800);
      if (!(await page.locator('#hourly-rate-0').inputValue())) { await page.locator('#hourly-rate-0').fill('100'); await page.locator('#hourly-rate-0').blur(); }
      await page.locator('#wizard-next').click(); await page.waitForTimeout(1200);
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1500);
      await shot('02-contract-review'); await page.locator('#wizard-finish').click();
      await until(() => contract(), 'contract saved', 60000); await page.locator('#contract-wizard-created-done').click().catch(() => {});
    }
    await check('contract-created-and-active', contract()?.is_active === true, contract());
    if (billingEmail() !== 'billing@cancel3.test') {
      await go(`/msp/clients/${CLIENT}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill('billing@cancel3.test'); await page.locator('#save-billing-config-btn').click();
      await until(() => billingEmail() === 'billing@cancel3.test', 'billing email saved');
    }
    if (!ticket()) {
      await go('/msp/create-ticket'); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 60000 });
      await page.locator('#ticket-quick-add-title').fill(TITLE);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.waitForTimeout(800); await page.keyboard.type('Cancel-3'); await page.waitForTimeout(1500);
      await page.getByRole('option', { name: new RegExp(CLIENT_NAME + '$') }).first().click().catch(async () => { await page.getByText(CLIENT_NAME, { exact: true }).last().click(); });
      await page.waitForTimeout(1200);
      for (const [id, empty] of [['#ticket-quick-add-board-picker', /Select Board/], ['#ticket-quick-add', /Select Status/]]) {
        if (!empty.test(await page.locator(id).innerText().catch(() => ''))) continue;
        await page.locator(id).click(); await page.waitForTimeout(800); await page.locator('[role=option]:not([aria-disabled="true"])').first().click(); await page.waitForTimeout(1200);
      }
      await page.locator('#ticket-quick-add-submit-btn').click(); await until(() => ticket(), 'ticket created', 60000);
    }

    await chapter('QA logs 30 minutes on Oct 18 and gets it approved; the October window is generated as a draft');
    if (!entries().some((e) => e.user_id === QA)) { await addTime(30); await until(() => entries().some((e) => e.user_id === QA), 'QA entry', 60000); }
    if (!team()) {
      await go('/msp/settings?tab=teams'); await page.locator('#add-new-team-btn').click(); await page.waitForTimeout(1000);
      await page.locator('#create-team-btn').locator('xpath=ancestor::div[2]//input').first().fill(TEAM);
      await page.locator('#account-manager-picker-trigger').click(); await page.waitForTimeout(800); await page.keyboard.type('QA'); await page.waitForTimeout(1200);
      await page.getByText('QA Tester', { exact: true }).last().click(); await page.waitForTimeout(800);
      await page.locator('#create-team-btn').click(); await until(() => team(), 'team created', 30000);
    }
    const approveSheet = async (sheetId, who) => {
      await go('/msp/time-sheet-approvals'); await page.waitForTimeout(3000);
      await page.locator(`#view-timesheet-${sheetId}-btn`).click(); await page.waitForTimeout(2500);
      await page.locator('#timesheet-approve-btn').click(); await page.waitForTimeout(2000);
      const c = page.getByRole('alertdialog').last(); if (await c.isVisible().catch(() => false)) await c.getByRole('button', { name: /approve|confirm|yes/i }).last().click();
      await until(() => sheet(sheetId) === 'APPROVED', 'sheet approved ' + who, 30000);
    };
    if (sheet(QA_SHEET) !== 'APPROVED') {
      if (sheet(QA_SHEET) !== 'SUBMITTED') {
        await go('/msp/time-entry/timesheet/' + QA_SHEET); await page.locator('#submit-timesheet-button').click(); await page.waitForTimeout(1500);
        const c = page.getByRole('dialog').last(); if (await c.isVisible().catch(() => false)) await c.getByRole('button', { name: /submit|confirm|yes/i }).last().click();
        await until(() => sheet(QA_SHEET) === 'SUBMITTED', 'QA sheet submitted', 30000);
      }
      await approveSheet(QA_SHEET, 'qa');
    }
    const d1 = invoices().find((i) => i.status === 'draft') || await generateOctober('03-d1');
    const e1 = entries().find((e) => e.user_id === QA);
    await check('d1-draft-bills-qa-entry', lines(d1.invoice_id).map((l) => l.entry_id).includes(e1.entry_id), { d1, lines: lines(d1.invoice_id) });

    await chapter('Glinda logs 30 minutes inside the same October period after the draft exists; QA approves her sheet');
    if (!entries().some((e) => e.user_id === GLINDA)) {
      await actor(glinda()); await addTime(30); await until(() => entries().some((e) => e.user_id === GLINDA), 'Glinda entry', 60000);
      const gs = entries().find((e) => e.user_id === GLINDA).time_sheet_id;
      await go('/msp/time-entry/timesheet/' + gs); await page.locator('#submit-timesheet-button').click(); await page.waitForTimeout(1500);
      const c = page.getByRole('dialog').last(); if (await c.isVisible().catch(() => false)) await c.getByRole('button', { name: /submit|confirm|yes/i }).last().click();
      await until(() => sheet(gs) === 'SUBMITTED', 'Glinda sheet submitted', 30000);
      await actor(actors.qa());
    }
    const e2 = entries().find((e) => e.user_id === GLINDA);
    if (sheet(e2.time_sheet_id) !== 'APPROVED') { if (!page.url().includes('localhost')) await actor(actors.qa()); await approveSheet(e2.time_sheet_id, 'glinda'); }
    await check('glinda-entry-in-october-approved-uninvoiced', String(e2.start_time).startsWith('2026-10') && entries().find((e) => e.user_id === GLINDA).approval_status === 'APPROVED'
      && entries().find((e) => e.user_id === GLINDA).invoiced === false, entries());

    await chapter('Automatic Invoices names Glinda\'s entry as late time closed by the draft');
    await openInvoicing();
    const carried = page.locator(`[data-testid="automatic-invoices-late-time-entry-${e2.entry_id}"]`); await carried.waitFor({ timeout: 30000 });
    const carriedText = await carried.innerText(); await shot('04-carried-by-draft'); fs.writeFileSync(path.join(dir, '04-carried.txt'), carriedText);
    await check('ui-late-entry-closed-by-the-draft', carriedText.includes(d1.invoice_number) && /draft/.test(carriedText), { text: carriedText });

    await chapter('Reverse the draft: the window reopens and the entry is no longer late');
    await reverseDraft(d1);
    await openInvoicing(); await shot('05-after-reverse');
    await check('ui-entry-no-longer-listed-as-late', await page.locator(`[data-testid="automatic-invoices-late-time-entry-${e2.entry_id}"]`).count() === 0, {});
    await chapter('Regenerate October: both entries bill on the regenerated window, neither labelled late');
    const d2 = await generateOctober('06-d2');
    const d2Lines = lines(d2.invoice_id); receipt('db-regenerated', { d2, lines: d2Lines });
    await check('regenerated-window-bills-both-without-late-label', d2Lines.map((l) => l.entry_id).sort().join() === [e1.entry_id, e2.entry_id].sort().join()
      && d2Lines.every((l) => !String(l.description).includes('late time')), d2Lines);

    await chapter('Cleanup through the product');
    await reverseDraft(d2);
    for (const [sheetId, who] of [[e2.time_sheet_id, 'glinda'], [QA_SHEET, 'qa']]) {
      if (sheet(sheetId) !== 'APPROVED') continue;
      await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2500);
      await page.locator(`#reverse-approval-${sheetId}-btn`).click(); await page.waitForTimeout(800); await page.locator('#reverse-approval-confirmation-confirm').click();
      await until(() => sheet(sheetId) !== 'APPROVED', 'reversed ' + who, 30000);
    }
    const del = async (sheetId, entryId) => {
      await go('/msp/time-entry/timesheet/' + sheetId); await page.waitForTimeout(2000);
      await page.locator(`#delete-workitem-${ticket().ticket_id}`).first().click(); await page.waitForTimeout(800); await confirmDialog(page, /delete|confirm|yes/i);
      await until(() => !entries().some((e) => e.entry_id === entryId), 'deleted ' + entryId, 30000);
    };
    await del(QA_SHEET, e1.entry_id);
    await actor(glinda()); await del(e2.time_sheet_id, e2.entry_id); await actor(actors.qa());
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
    await crow.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
    await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click();
    await until(() => contract().is_active === false, 'contract terminated', 60000);
    if (team()) { await go('/msp/settings?tab=teams'); await page.locator(`#delete-team-${team().team_id}-btn`).click(); await page.waitForTimeout(800); await confirmDialog(page, /delete|confirm|yes/i); }
    await go(`/msp/clients/${CLIENT}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await page.locator('#client-billing-email-input').fill(''); await page.locator('#save-billing-config-btn').click(); await page.waitForTimeout(2000);
    const after = { contract: contract(), invoices: invoices(), entries: entries(), qaSheet: sheet(QA_SHEET), glindaSheet: sheet(e2.time_sheet_id), team: team() || null, billingEmail: billingEmail() };
    receipt('db-after', after);
    await check('cleanup-no-invoices-no-entries-contract-terminated', after.invoices.length === 0 && after.entries.length === 0 && after.contract.is_active === false && !after.team, after);
    return { status: 'passed', limitations: ['The disposable contract and ticket remain (terminated / open) on the disposable client; QA\'s and Glinda\'s sheets end Changes Requested (reversal cannot return a sheet to Draft).'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
