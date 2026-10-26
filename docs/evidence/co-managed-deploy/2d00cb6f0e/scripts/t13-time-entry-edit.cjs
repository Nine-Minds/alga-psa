// T13: an MSP edit of an existing recorded time entry on a shared customer ticket. QA records 30 minutes of
// commercial time on White Rabbit ticket 000016, then edits that entry from his timesheet (45 minutes, new note).
// The edit is stored on the same entry with QA as the editing actor, keeps its qualified co-managed work
// reference and contract resolution, and the customer's view of MSP effort reflects it. The entry is deleted.
const fs = require('fs'), path = require('path');
const { scenario, until } = require('./runtime.cjs');
const { actors, json, OZ } = require('./common.cjs');
const QA = '86952555-610c-4737-be41-a9236cfa9cdb', SHEET = '206e125c-5500-49ef-9b7f-d1b0e1de4afa';
const WR = 'c64b2666-7dd6-4c61-8ced-4b233f628e61', REL = '2be5cb32-91e8-491a-9ec4-16ab019c7d40', T = '81245210-accc-40ad-afaa-6680a85a75b0';
const MARK = 'T13-2D00';
const entry = () => json(`select entry_id, work_item_type, work_item_id, co_managed_work_reference_id, service_id, contract_line_id, billing_mode, billable_duration, notes, created_by, updated_by, created_at, updated_at, approval_status, invoiced from time_entries where tenant='${OZ}' and user_id='${QA}' and notes like '${MARK}%'`)[0];
(async () => {
  const r = await scenario(process.env.CM_ROOT, '05-t13-time-entry-edit', async ({ page, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (n, d) => fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(d, null, 2));
    await chapter('QA records 30 minutes of MSP time on shared ticket 000016');
    await actor(actors.qa());
    if (!entry()) {
      await go(`/msp/co-management/tickets/${WR}/${REL}/${T}`); await page.locator('#ticket-details-properties-add-time-entry-btn').click();
      await page.locator('#time-entry-dialog-save-dialog-btn').waitFor();
      await page.locator('[role=dialog] button', { hasText: 'Select a service' }).first().click(); await page.waitForTimeout(800);
      await page.getByRole('option', { name: 'Basic Support' }).first().click().catch(async () => page.getByText('Basic Support').last().click());
      await page.locator('#time-entry-dialog-duration-hours-0').fill('0'); await page.locator('#time-entry-dialog-duration-hours-0').press('Tab');
      await page.locator('#time-entry-dialog-duration-minutes-0').fill('30'); await page.locator('#time-entry-dialog-duration-minutes-0').press('Tab');
      await page.locator('#time-entry-dialog-notes-0').fill(`${MARK} recorded`); await page.locator('#time-entry-dialog-save-dialog-btn').click();
      await until(() => entry(), 'entry recorded', 60000);
    }
    const before = entry(); receipt('db-before-edit', before);
    await check('recorded-msp-commercial-time-on-the-shared-reference', before.work_item_type === 'co_managed' && before.billing_mode === 'commercial' && before.billable_duration === 30, before);

    await chapter('QA edits the recorded entry from his timesheet: 45 minutes and a corrected note');
    await go('/msp/time-entry/timesheet/' + SHEET); await page.waitForTimeout(2500);
    const cell = page.locator(`[data-automation-id^="time-cell-entry-${before.work_item_id}-"]`).first();
    await cell.click(); await page.waitForTimeout(2000); await inspect('01-entry-dialog'); await shot('01-entry-dialog');
    const edit = page.locator('[id$="-edit-entry-0-btn"]').first(); if (await edit.count()) { await edit.click(); await page.waitForTimeout(1000); }
    await page.locator('[id$="-duration-hours-0"]').first().fill('0'); await page.locator('[id$="-duration-hours-0"]').first().press('Tab');
    await page.locator('[id$="-duration-minutes-0"]').first().fill('45'); await page.locator('[id$="-duration-minutes-0"]').first().press('Tab');
    await page.locator('[id$="-notes-0"]').first().fill(`${MARK} corrected after review`); await page.waitForTimeout(600);
    const saveEntry = page.locator('[id$="-save-entry-0-btn"]').first(); if (await saveEntry.count()) await saveEntry.click();
    const saveDialog = page.locator('#time-entry-dialog-save-dialog-btn, [id$="-save-dialog-btn"]').first(); if (await saveDialog.isVisible().catch(() => false)) await saveDialog.click();
    await until(() => entry()?.billable_duration === 45, 'edit saved', 60000); await shot('02-after-edit');
    const after = entry(); receipt('db-after-edit', after);
    await check('edit-updates-the-same-entry-with-qa-as-editor', after.entry_id === before.entry_id && after.billable_duration === 45 && after.notes.includes('corrected')
      && after.updated_by === QA && new Date(after.updated_at) > new Date(before.updated_at), { before: { updated_at: before.updated_at }, after });
    await check('edit-keeps-the-qualified-work-reference-and-contract-resolution', after.work_item_type === 'co_managed' && after.co_managed_work_reference_id === before.co_managed_work_reference_id
      && after.contract_line_id === before.contract_line_id && after.billing_mode === 'commercial', after);

    await chapter('Alice (White Rabbit IT) sees the MSP effort on the shared ticket, never QA\'s note');
    await actor(actors.alice()); await go('/msp/tickets/' + T); await page.waitForTimeout(3000);
    const text = await page.locator('body').innerText(); fs.writeFileSync(path.join(dir, '03-alice-ticket.txt'), text); await shot('03-alice-ticket');
    await check('customer-never-sees-the-msp-time-note', !text.includes(`${MARK} corrected`) && !text.includes(`${MARK} recorded`), {});

    await chapter('Cleanup: QA deletes the entry from the timesheet entry dialog');
    await actor(actors.qa()); await go('/msp/time-entry/timesheet/' + SHEET); await page.waitForTimeout(2500);
    await page.locator(`[data-automation-id^="time-cell-entry-${before.work_item_id}-"]`).first().click(); await page.waitForTimeout(1500);
    await page.locator('[id$="-delete-entry-0-btn"]').first().click(); await page.waitForTimeout(800);
    const d = page.locator('[role=alertdialog],[role=dialog]').last(); const b = d.getByRole('button', { name: /delete|confirm|yes/i }).last(); if (await b.count()) await b.click();
    await page.waitForTimeout(1500); if (entry()) await page.locator('#time-entry-dialog-save-dialog-btn').first().click({ timeout: 5000 }).catch(() => {});
    await until(() => !entry(), 'entry deleted', 60000).catch(() => {});
    await check('entry-deleted', !entry(), entry() || {});
    return { status: 'passed', limitations: ['Customer-side MSP effort totals are shown only to roles the effort policy admits; the check asserts the MSP note never reaches the customer view.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
