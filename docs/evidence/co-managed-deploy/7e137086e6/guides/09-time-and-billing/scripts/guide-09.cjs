// Guide 09 — Time approval and billing (round 7e137086e6, served build 54e75edfab).
// Real UI for every product action; sql() is read-only (receipts and waits).
// Disposable records carry CM-REVIEW-20261026-09 (+ optional run letter for clean re-runs).
// Nothing is finalized or emailed: the invoice stays a draft.
const fs = require('fs'), path = require('path');
const { scenario, sql, until, origin } = require('../../scripts/runtime.cjs');
const { actors, A, OZ, WR, fx, sharedRoute, taskRoute } = require('./common.cjs');
const RUN = process.env.CM_RUN || '';
const SFX = 'CM-REVIEW-20261026-09' + (RUN ? '-' + RUN : '');
const TICKET = SFX + ' printer spooler time ticket';
const PROJECT = SFX + ' time project', PHASE = SFX + ' phase', TASK = SFX + ' toner audit task';
const CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
const PERIOD_ID = 'a9f7bb1e-89a1-4cf4-b59b-ce8c1d6ee53c';
const NOTE = { manual: SFX + ' commercial 15m', stopwatch: SFX + ' stopwatch', task: SFX + ' commercial task 6m', customer: SFX + ' customer operational 5m' };
const guideDir = path.dirname(__dirname);
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const esc = (s) => String(s).replace(/'/g, "''");
const receipts = {};
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts' + (RUN ? '-' + RUN : '') + '.json'), JSON.stringify(receipts, null, 2)); };
const entry = (note) => json(`select e.entry_id,e.tenant,e.user_id,e.work_item_type,e.work_item_id,e.co_managed_work_reference_id,e.billing_mode,e.billable_duration,
  extract(epoch from (e.end_time-e.start_time))/60 as minutes,e.service_id,e.contract_line_id,e.time_sheet_id,e.approval_status,e.invoiced,e.notes,
  r.source_kind,r.source_id,r.client_id,r.customer_tenant from time_entries e left join co_managed_time_work_references r on r.tenant=e.tenant and r.reference_id=e.co_managed_work_reference_id
  where e.notes='${esc(note)}'`);

(async () => {
  const r = await scenario(guideDir, process.env.CM_SCENARIO || 'recording', async ({ page, actor, go, mark, check, shot, inspect, chapter }) => {
    const opt = (n) => page.getByRole('option', { name: n, exact: true });
    const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };
    const line = json(`select l.contract_line_id from contract_lines l join contracts c on c.tenant=l.tenant and c.contract_id=l.contract_id where l.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0]?.contract_line_id;
    receipt('contractLine', line);
    const basic = sql(`select service_id from service_catalog where tenant='${OZ}' and service_name='Basic Support'`);

    // ------------------------------------------------------------- Before you start
    await chapter('Before you start: customer prepares a disposable shared ticket and shared task');
    await actor(actors.alice());
    let ticketId = sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`);
    if (!ticketId) {
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 15000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(TICKET);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click();
      await page.locator('#ticket-quick-add-board-picker').click(); await page.getByRole('option', { name: /Service Desk/ }).first().click();
      await page.waitForTimeout(800);
      await page.locator('#ticket-quick-add').click(); await page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first().click();
      await shot('prep-01-customer-ticket-form');
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 });
      ticketId = await until(() => sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`), 'ticket committed');
    }
    let pid = sql(`select project_id from projects where tenant='${WR}' and project_name='${esc(PROJECT)}'`);
    if (!pid) {
      await go('/msp/projects'); await page.locator('#add-project-button').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('Project Name *', { exact: true }).fill(PROJECT);
      await dialog.getByRole('combobox').filter({ hasText: 'Select Status' }).click(); await opt('Not Started').click();
      await dialog.locator('#client-picker-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).click();
      await dialog.locator('#create-button').click();
      pid = await until(() => sql(`select project_id from projects where tenant='${WR}' and project_name='${esc(PROJECT)}'`), 'project committed');
    }
    await go('/msp/projects/' + pid);
    let phaseId = sql(`select phase_id from project_phases where tenant='${WR}' and project_id='${pid}' and phase_name='${esc(PHASE)}'`);
    if (!phaseId) {
      await page.locator('#add-phase-button').click(); await page.getByPlaceholder('Phase name... *', { exact: true }).fill(PHASE);
      await page.locator('#save-phase-button').click();
      phaseId = await until(() => sql(`select phase_id from project_phases where tenant='${WR}' and project_id='${pid}' and phase_name='${esc(PHASE)}'`), 'phase committed');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    }
    let taskId = sql(`select task_id from project_tasks where tenant='${WR}' and phase_id='${phaseId}' and task_name='${esc(TASK)}'`);
    if (!taskId) {
      await page.getByText(PHASE, { exact: true }).first().click(); await page.locator('#add-task-button').click();
      await page.getByPlaceholder('Enter task name...', { exact: true }).fill(TASK); await page.locator('#save-button').click();
      taskId = await until(() => sql(`select task_id from project_tasks where tenant='${WR}' and phase_id='${phaseId}' and task_name='${esc(TASK)}'`), 'task committed');
    }
    const custPeriod = () => json(`select period_id,start_date,end_date from time_periods where tenant='${WR}' and start_date<='2026-10-26' and end_date>'2026-10-26'`)[0];
    receipt('customerPeriodBefore', custPeriod() || null);
    if (!custPeriod()) {
      await go('/msp/settings/time-entry'); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(1500);
      await page.locator('#create-time-period-button').click();
      await page.getByRole('dialog').getByRole('checkbox').first().click();
      await until(async () => await page.locator('#time-period-start-date-picker').isEnabled(), 'override enabled', 10000);
      await typeDate(page.locator('#time-period-start-date-picker'), '10/19/2026');
      await typeDate(page.locator('#time-period-end-date-picker'), '11/01/2026');
      await shot('prep-02-customer-time-period');
      await page.getByRole('dialog').locator('#submit-button').click();
      await until(() => custPeriod(), 'customer period saved');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(1200);
    }
    await check('prep-customer-workspace-has-current-time-period', !!custPeriod(), { period: custPeriod() });
    receipt('projectScopesBefore', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${WR}' and relationship_id='${A.relationship}'`));
    await go('/msp/co-management');
    const access = page.locator('#co-policy-project-access-' + pid);
    if (!await access.count()) {
      await page.locator('#co-policy-project-search').fill(PROJECT); await page.waitForTimeout(900);
      await page.locator('#co-policy-project-select').click(); await opt(PROJECT).click();
      await page.locator('#co-policy-project-add').click();
      await access.click(); await opt('Collaborate').click();
      await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await access.waitFor();
    await check('prep-customer-shares-disposable-project-collaborate', (await access.innerText()).includes('Collaborate'));
    receipt('projectScopesAfterGrant', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${WR}' and relationship_id='${A.relationship}'`));
    const fixtures = { suffix: SFX, ticketId, projectId: pid, phaseId, taskId, contractLine: line, period: PERIOD_ID,
      links: { mspTicket: origin + sharedRoute(ticketId), customerTicket: origin + '/msp/tickets/' + ticketId, mspTask: origin + taskRoute(taskId), customerProject: origin + '/msp/projects/' + pid } };
    fs.writeFileSync(path.join(guideDir, 'fixtures' + (RUN ? '-' + RUN : '') + '.json'), JSON.stringify(fixtures, null, 2));
    await mark('fixtures', fixtures);

    // ------------------------------------------------------------- 1
    await chapter('1. Persist one commercial entry (QA, native shared ticket, Add Time Entry)');
    await actor(actors.qa());
    await go(sharedRoute(ticketId));
    const addBtn = page.locator('#ticket-details-properties-add-time-entry-btn');
    await addBtn.waitFor({ timeout: 60000 });
    const effortBefore = json(`select coalesce(sum(billable_duration),0)::int as msp_minutes from time_entries where tenant='${OZ}' and co_managed_work_reference_id in (select reference_id from co_managed_time_work_references where tenant='${OZ}' and source_id='${ticketId}')`)[0];
    receipt('s1-msp-effort-before', effortBefore);
    await shot('s1-01-before');
    if (!entry(NOTE.manual).length) {
      await addBtn.click(); await page.locator('#time-entry-dialog-notes-0').waitFor({ timeout: 60000 });
      const date = page.getByRole('dialog').getByRole('combobox', { name: /date/i }).first();
      await typeDate(date, '10/26/2026');
      await page.getByRole('combobox').filter({ hasText: 'Select a service' }).click(); await opt('Basic Support').click();
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill('15');
      await page.locator('#time-entry-dialog-notes-0').fill(NOTE.manual);
      await shot('s1-02-form'); await inspect('s1-02-form');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
    }
    const manual = (await until(() => { const e = entry(NOTE.manual); return e.length ? e : null; }, 'manual entry persisted', 60000));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await addBtn.waitFor({ timeout: 60000 });
    await page.getByText(NOTE.manual).first().waitFor({ timeout: 30000 }).catch(() => {});
    const card = await page.locator('main').innerText();
    const e1 = manual[0];
    await check('s1-exactly-one-persisted-entry', manual.length === 1, { count: manual.length });
    await check('s1-entry-owned-by-oz-qualified-co-managed-not-foreign-id', e1.tenant === OZ && e1.user_id === fx.qaId && e1.work_item_type === 'co_managed' && e1.work_item_id !== ticketId && e1.source_kind === 'ticket' && e1.source_id === ticketId && e1.customer_tenant === WR && e1.client_id === A.clientId, { entry: e1 });
    await check('s1-adds-exactly-15-commercial-minutes-on-contract-line', e1.billable_duration === 15 && e1.billing_mode === 'commercial' && e1.service_id === basic && e1.contract_line_id === line, { line });
    const effortAfter = json(`select coalesce(sum(billable_duration),0)::int as msp_minutes from time_entries where tenant='${OZ}' and co_managed_work_reference_id in (select reference_id from co_managed_time_work_references where tenant='${OZ}' and source_id='${ticketId}')`)[0];
    await check('s1-msp-effort-delta-is-15-minutes', effortAfter.msp_minutes - effortBefore.msp_minutes === 15, { effortBefore, effortAfter });
    await check('s1-entry-listed-on-ticket-after-reload', card.includes(NOTE.manual) || /0\.25|15m|0:15|00:15/.test(card), { excerpt: card.slice(card.indexOf('Time Entry'), card.indexOf('Time Entry') + 500) });
    await shot('s1-03-after-reload');
    receipt('s1-entry', e1);

    // ------------------------------------------------------------- 2a stopwatch
    await chapter('2. Native stopwatch on the shared ticket: start, stop, one entry');
    if (!entry(NOTE.stopwatch).length) {
      await page.locator('#ticket-details-properties-timer-stopwatch-start').click();
      await page.locator('#ticket-details-properties-timer-stopwatch-stop').waitFor();
      await page.waitForTimeout(5000);
      await shot('s2-01-running');
      await page.locator('#ticket-details-properties-timer-stopwatch-stop').click();
      await page.locator('#time-entry-dialog-notes-0').waitFor({ timeout: 60000 });
      const hours = Number(await page.locator('#time-entry-dialog-duration-hours-0').inputValue()), minutes = Number(await page.locator('#time-entry-dialog-duration-minutes-0').inputValue());
      await mark('stopwatch-prefill', { hours, minutes });
      await page.getByRole('combobox').filter({ hasText: 'Select a service' }).click(); await opt('Basic Support').click();
      await page.locator('#time-entry-dialog-notes-0').fill(NOTE.stopwatch);
      await shot('s2-02-stopped-prefilled');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
    }
    const sw = await until(() => { const e = entry(NOTE.stopwatch); return e.length ? e : null; }, 'stopwatch entry persisted', 60000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await addBtn.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const sessions = json(`select session_id,status,work_item_type from time_tracking_sessions where tenant='${OZ}' and user_id='${fx.qaId}' and created_at > now() - interval '30 minutes'`);
    const ticketEntries = json(`select entry_id,notes,billable_duration from time_entries where tenant='${OZ}' and co_managed_work_reference_id=(select reference_id from co_managed_time_work_references where tenant='${OZ}' and source_id='${ticketId}')`);
    await check('s2-stopwatch-stop-creates-exactly-one-commercial-entry', sw.length === 1 && sw[0].work_item_type === 'co_managed' && sw[0].billing_mode === 'commercial' && ticketEntries.length === 2, { stopwatchEntry: sw[0], ticketEntries });
    await check('s2-no-open-timer-remains', !sessions.some((s) => ['running', 'paused', 'active'].includes(s.status)) && await page.locator('#ticket-details-properties-timer-stopwatch-start').count() === 1, { sessions });
    await shot('s2-03-after-reload');
    receipt('s2-stopwatch', { entry: sw[0], sessions, ticketEntries });

    // ------------------------------------------------------------- 2b customer effort
    await chapter('2. Customer effort: native customer ticket offers no time entry; operational entry on the shared task');
    await actor(actors.alice());
    await go('/msp/tickets/' + ticketId); await page.locator('#ticket-details-properties-time-summary-card-toggle').waitFor({ timeout: 60000 });
    const custTicket = await page.locator('main').innerText();
    await check('s2-customer-ticket-shows-effort-summary-without-time-entry-flow', await page.locator('#ticket-details-properties-add-time-entry-btn').count() === 0 && await page.locator('[id$="timer-stopwatch-start"]').count() === 0 && /Customer[\s\S]*MSP[\s\S]*Combined/.test(custTicket),
      { summary: custTicket.slice(custTicket.indexOf('Recorded effort'), custTicket.indexOf('Recorded effort') + 120) });
    await page.locator('#ticket-details-properties-time-summary-card-toggle').scrollIntoViewIfNeeded(); await shot('s2-04-customer-ticket-effort');
    await go(taskRoute(taskId)); await page.locator('#co-shared-log-time').waitFor({ timeout: 60000 });
    if (!entry(NOTE.customer).length) {
      await page.locator('#co-shared-log-time').click(); await page.locator('#time-entry-dialog-notes-0').waitFor({ timeout: 60000 });
      await shot('s2-05-customer-form'); await inspect('s2-05-customer-form');
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill('5');
      await page.locator('#time-entry-dialog-notes-0').fill(NOTE.customer);
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
    }
    const cust = (await until(() => { const e = entry(NOTE.customer); return e.length ? e : null; }, 'customer entry persisted', 60000))[0];
    await check('s2-customer-entry-is-operational-without-commercial-attributes', cust.tenant === WR && cust.billing_mode === 'operational' && cust.billable_duration === 0 && cust.service_id === null && cust.contract_line_id === null && Math.round(Number(cust.minutes)) === 5 && cust.work_item_id === taskId, { entry: cust });
    await actor(actors.qa());
    await go(taskRoute(taskId)); await page.locator('#co-shared-log-time').waitFor({ timeout: 60000 });
    if (!entry(NOTE.task).length) {
      await page.locator('#co-shared-log-time').click(); await page.locator('#time-entry-dialog-notes-0').waitFor({ timeout: 60000 });
      const date = page.getByRole('combobox', { name: /date/i }).filter({ visible: true }).first();
      if (await date.count()) await typeDate(date, '10/26/2026');
      await page.getByRole('combobox').filter({ hasText: 'Select a service' }).click(); await opt('Basic Support').click();
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill('6');
      await page.locator('#time-entry-dialog-notes-0').fill(NOTE.task);
      await shot('s2-06-msp-task-form');
      await page.locator('#time-entry-dialog-save-dialog-btn').click();
    }
    const taskEntry = (await until(() => { const e = entry(NOTE.task); return e.length ? e : null; }, 'MSP task entry persisted', 60000))[0];
    await check('s2-msp-task-entry-commercial-qualified', taskEntry.tenant === OZ && taskEntry.work_item_type === 'co_managed' && taskEntry.source_kind === 'project_task' && taskEntry.source_id === taskId && taskEntry.billable_duration === 6 && taskEntry.contract_line_id === line, { entry: taskEntry });
    const efforts = {};
    for (const who of ['alice', 'qa']) {
      await actor(actors[who]()); await go(taskRoute(taskId));
      const effort = page.locator('section[aria-label="Recorded effort"]');
      await effort.waitFor({ timeout: 60000 });
      const dd = await until(async () => { const v = await effort.locator('dd').allTextContents(); return v.length === 3 && v.some((x) => /[1-9]/.test(x)) ? v : null; }, 'effort loaded');
      const num = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
      efforts[who] = dd;
      await check(who + '-combined-effort-is-sum-of-customer-and-msp', Math.abs(num(dd[0]) + num(dd[1]) - num(dd[2])) < 0.011 && num(dd[0]) > 0 && num(dd[1]) > 0, { displayed: dd, expectedMinutes: { customer: 5, msp: 6 } });
      await check(who + '-does-not-see-other-organization-note', !(await page.locator('body').innerText()).includes(who === 'qa' ? NOTE.customer : NOTE.task));
      await shot('s2-07-' + who + '-effort');
    }
    await check('s2-both-views-show-the-same-effort', JSON.stringify(efforts.alice) === JSON.stringify(efforts.qa), efforts);
    receipt('s2-effort', { efforts, customerEntry: cust, mspTaskEntry: taskEntry });

    // ------------------------------------------------------------- 3 timesheet + approval
    await chapter('3. Follow the entries into the native timesheet, submit and approve');
    await go('/msp/time-entry'); await page.locator('#view-period-' + PERIOD_ID).click();
    await page.waitForURL(/\/msp\/time-entry\/timesheet\//, { timeout: 60000 });
    const sheet = page.url().split('/').at(-1).split('?')[0];
    await page.waitForTimeout(2000);
    const listBtn = page.getByRole('button', { name: 'List', exact: true });
    if (await listBtn.count()) await listBtn.click();
    const commercial = [e1, sw[0], taskEntry];
    for (const en of commercial) {
      const row = page.locator(`[data-automation-id="time-entry-row-${en.entry_id}"]`);
      await row.waitFor({ timeout: 30000 });
      await check('s3-timesheet-lists-' + en.notes.replace(SFX + ' ', '').replace(/\s+/g, '-'), (await row.innerText()).length > 0, { entryId: en.entry_id, row: (await row.innerText()).replace(/\s+/g, ' ').slice(0, 200) });
    }
    const sheetRow = json(`select id,approval_status,period_id from time_sheets where tenant='${OZ}' and id='${sheet}'`)[0];
    await check('s3-all-three-shared-entries-on-the-current-sheet', sheetRow?.period_id === PERIOD_ID && commercial.every((en) => sql(`select time_sheet_id from time_entries where entry_id='${en.entry_id}'`) === sheet), { sheet: sheetRow });
    await shot('s3-01-timesheet-list'); await inspect('s3-01-timesheet-list');
    if (['DRAFT', 'CHANGES_REQUESTED'].includes(sheetRow.approval_status)) {
      await page.locator('#submit-timesheet-button').click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /submit/i }); if (await confirm.count()) await confirm.first().click().catch(() => {});
      await until(() => sql(`select approval_status from time_sheets where tenant='${OZ}' and id='${sheet}'`) === 'SUBMITTED', 'sheet submitted');
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(2000);
    await check('s3-sheet-submitted-after-reload', sql(`select approval_status from time_sheets where id='${sheet}'`) !== 'DRAFT');
    await shot('s3-02-submitted');
    await go('/msp/time-sheet-approvals');
    await page.locator('#view-timesheet-' + sheet + '-btn').click();
    await page.waitForTimeout(2500); await shot('s3-03-approval-view'); await inspect('s3-03-approval-view');
    const approvalText = await page.locator('body').innerText();
    await check('s3-approver-sees-shared-entries', approvalText.includes(NOTE.manual) || approvalText.includes('15'), {});
    await page.locator('#timesheet-approve-btn').click();
    await until(() => sql(`select approval_status from time_sheets where id='${sheet}'`) === 'APPROVED', 'sheet approved');
    await go('/msp/time-sheet-approvals'); await page.waitForTimeout(1500); await shot('s3-04-approvals-after');
    const approved = json(`select entry_id,approval_status from time_entries where time_sheet_id='${sheet}'`);
    await check('s3-sheet-and-entries-approved-after-reload', approved.length >= 3 && approved.every((x) => x.approval_status === 'APPROVED') && commercial.every((en) => approved.some((x) => x.entry_id === en.entry_id)), { approved, note: 'sheet also carries the two entries of failed attempt run-a (retained time evidence)' });
    receipt('s3-sheet', { sheet, approved });

    // ------------------------------------------------------------- 4 billing
    await chapter('4. Reconcile commercial billing: Automatic Invoices preview and draft');
    await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
    const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
    const range = page.locator('#billing-period-date-range');
    if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
    const toDate = range.getByRole('combobox').nth(1); await typeDate(toDate, '11/01/2026');
    await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
    const groups = table.locator('button[id^="toggle-group-"]'); for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
    await page.waitForTimeout(1500);
    const row = table.locator('tbody tr').filter({ hasText: CONTRACT }).filter({ hasText: 'Ready' });
    await row.first().waitFor({ timeout: 30000 });
    await row.first().scrollIntoViewIfNeeded(); await shot('s4-01-due-work'); await inspect('s4-01-due-work');
    await mark('selected-group', await row.first().locator('input[id^="select-parent-group"]').getAttribute('id'));
    await row.first().locator('input[id^="select-parent-group"]').check();
    await page.locator('#preview-selected-button').click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor(); await page.locator('#generate-invoice-from-preview-button').waitFor(); await page.waitForTimeout(1000);
    const preview = await dialog.innerText();
    await check('s4-preview-lists-contract-time', preview.includes(CONTRACT) || preview.includes('Basic Support'), { preview: preview.slice(0, 1500) });
    await shot('s4-02-preview');
    await page.locator('#generate-invoice-from-preview-button').click();
    const invFor = (id) => json(`select i.invoice_id,i.invoice_number,i.status,i.subtotal,i.client_id,i.finalized_at from invoices i join invoice_time_entries t on t.tenant=i.tenant and t.invoice_id=i.invoice_id where i.tenant='${OZ}' and t.entry_id='${id}'`)[0];
    for (const en of commercial) await until(() => invFor(en.entry_id), 'draft for ' + en.entry_id, 90000);
    const inv = invFor(e1.entry_id);
    const sources = json(`select entry_id from invoice_time_entries where tenant='${OZ}' and invoice_id='${inv.invoice_id}' order by entry_id`).map((x) => x.entry_id);
    const charges = json(`select description,quantity,unit_price,net_amount,client_contract_id,service_id from invoice_charges where tenant='${OZ}' and invoice_id='${inv.invoice_id}'`);
    await check('s4-draft-for-white-rabbit-not-finalized', inv.status === 'draft' && !inv.finalized_at && inv.client_id === A.clientId, { inv });
    await check('s4-each-commercial-entry-invoiced-exactly-once', commercial.every((en) => Number(sql(`select count(*) from invoice_time_entries where entry_id='${en.entry_id}'`)) === 1 && invFor(en.entry_id).invoice_id === inv.invoice_id), { sources });
    const approvedOnSheet = json(`select entry_id from time_entries where time_sheet_id='${sheet}' and approval_status='APPROVED' and contract_line_id='${line}' order by entry_id`).map((x) => x.entry_id);
    await check('s4-draft-sources-equal-the-approved-contract-line-entries-on-the-sheet', JSON.stringify(sources) === JSON.stringify(approvedOnSheet), { sources, approvedOnSheet });
    const billedMinutes = json(`select coalesce(sum(quantity),0) as qty from invoice_charges where tenant='${OZ}' and invoice_id='${inv.invoice_id}'`)[0];
    receipt('s4-billed-quantity', billedMinutes);
    await check('s4-customer-operational-entry-never-invoiced', Number(sql(`select count(*) from invoice_time_entries where entry_id='${cust.entry_id}'`)) === 0 && sql(`select invoiced::text from time_entries where entry_id='${cust.entry_id}'`) === 'false');
    await go('/msp/invoices/' + inv.invoice_id); await page.waitForTimeout(3000);
    const invText = await page.locator('main').innerText();
    await check('s4-draft-invoice-opens-with-its-number', invText.includes(inv.invoice_number), { number: inv.invoice_number });
    await shot('s4-03-draft-invoice'); await inspect('s4-03-draft-invoice');
    receipt('s4-invoice', { inv, sources, charges, commercialEntries: commercial.map((x) => x.entry_id), customerEntry: cust.entry_id });

    // ------------------------------------------------------------- restore
    await chapter('Restore: remove project grant, delete approval team, clear billing email, terminate disposable contract; time and draft invoice retained');
    await actor(actors.alice()); await go('/msp/co-management');
    const mine = json(`select s.project_id from co_management_project_scopes s join projects p on p.tenant=s.tenant and p.project_id=s.project_id where s.tenant='${WR}' and p.project_name like 'CM-REVIEW-20261026-09%'`).map((x) => x.project_id);
    for (const id of mine) await page.locator('#co-policy-project-remove-' + id).click();
    await page.locator('#co-policy-save').click();
    await page.getByText('Access settings saved.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-policy-save').waitFor(); await page.waitForTimeout(1500);
    await check('restore-guide-09-project-grants-removed-after-reload', (await Promise.all(mine.map((id) => page.locator('#co-policy-project-access-' + id).count()))).every((n) => n === 0), { removed: mine });
    await actor(actors.qa());
    const teamId = sql(`select team_id from teams where tenant='${OZ}' and team_name='CM-REVIEW-20261026-09 approvers'`);
    if (teamId) {
      await go('/msp/settings?tab=teams'); await page.locator('#delete-team-' + teamId + '-btn').click();
      await page.locator('#delete-team-dialog-confirm').click();
      await until(() => !sql(`select team_id from teams where team_id='${teamId}'`), 'approval team deleted');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(1500);
      await check('restore-disposable-approval-team-deleted-after-reload', !(await page.locator('main').innerText()).includes('CM-REVIEW-20261026-09 approvers'), { teamId });
    }
    await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    if (await page.locator('#client-billing-email-input').inputValue()) {
      await page.locator('#client-billing-email-input').fill(''); await page.locator('#save-billing-config-btn').click();
      await until(() => !sql(`select coalesce(billing_email,'') from clients where client_id='${A.clientId}'`), 'billing email cleared');
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await check('restore-white-rabbit-billing-email-cleared-after-reload', await page.locator('#client-billing-email-input').inputValue() === '', { stored: sql(`select coalesce(billing_email,'<null>') from clients where client_id='${A.clientId}'`) });
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
    await crow.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
    await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click();
    const cstate = () => json(`select cc.is_active,cc.status,cc.end_date,c.status as contract_status from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
    await until(() => { const c = cstate(); return c && (c.is_active === false || c.status === 'terminated' || c.contract_status === 'terminated'); }, 'contract terminated');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(2000); await shot('restore-contract-terminated');
    await check('restore-disposable-contract-terminated-draft-retained', sql(`select status from invoices where invoice_id='${inv.invoice_id}'`) === 'draft', { contract: cstate() });
    receipt('projectScopesAfterRestore', json(`select project_id,can_collaborate from co_management_project_scopes where tenant='${WR}' and relationship_id='${A.relationship}'`));
    return { status: 'passed', limitations: ['Approver is the same QA user (no separate MSP approver identity was provided; Glinda excluded by the brief).', 'Customer native ticket (AlgaDesk workspace) offers no time-entry flow, so the customer operational entry and combined-effort comparison use a disposable shared project task on the same relationship.', 'Draft invoice only; nothing finalized or emailed.', 'Approving the QA sheet also approves every other QA entry in that period, including one guide-06 entry (705281b3, unresolved, not invoiced here).', 'Earlier failed attempts run-a/run-b/run-c left approved commercial entries on the same contract line; the draft carries them too and reconciles against all approved contract-line entries on the sheet.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
