// Guide 09 preparation (recorded, native UI): attempt run-e generated draft INV-000001 and then failed on a receipt
// query of this harness (not the product). Reverse that draft through Invoicing > Drafts and re-open the QA sheet so
// the clean run can generate the draft inside one recording. Receipts of the reversed draft stay in attempts/run-e.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
const INV = '3121e2b0-55db-4d8e-95ff-c6dbbe926769', SHEET = 'b1adac9e-430c-4c28-abe8-6389bd9a7e70';
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-reverse-run-e-draft', async ({ page, actor, go, mark, check, shot, chapter, dir }) => {
    const sheet = () => sql(`select approval_status from time_sheets where id='${SHEET}'`);
    const before = { invoice: sql(`select row_to_json(i) from (select invoice_number,status,subtotal from invoices where invoice_id='${INV}') i`), sheet: sheet() };
    await mark('before', before);
    await actor(actors.qa());
    await chapter('Prep: reverse the attempt draft');
    if (Number(sql(`select count(*) from invoices where invoice_id='${INV}'`))) {
      await go('/msp/billing?tab=invoicing&subtab=drafts'); await page.locator('#draft-row-actions-' + INV).click();
      await page.locator('#reverse-draft-' + INV + '-menu-item').click(); await page.locator('#reverse-draft-confirmation-confirm').click();
      await until(() => Number(sql(`select count(*) from invoices where invoice_id='${INV}'`)) === 0, 'draft reversed', 60000);
    }
    await check('attempt-draft-reversed-entries-reopened', Number(sql(`select count(*) from time_entries where time_sheet_id='${SHEET}' and invoiced`)) === 0);
    await shot('01-drafts-after');
    await chapter('Prep: re-open the sheet');
    await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2000);
    if (sheet() === 'APPROVED') { await page.locator('#reverse-approval-' + SHEET + '-btn').click(); await page.locator('#reverse-approval-confirmation-confirm').click(); await until(() => sheet() !== 'APPROVED', 'reversed'); }
    if (sheet() === 'SUBMITTED') { await go('/msp/time-sheet-approvals'); await page.locator('#view-timesheet-' + SHEET + '-btn').click(); await page.locator('#timesheet-request-changes-btn').click(); await until(() => sheet() === 'CHANGES_REQUESTED', 'returned'); }
    await check('sheet-open-for-changes', ['CHANGES_REQUESTED', 'DRAFT'].includes(sheet()), { sheet: sheet() });
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after: { invoiceRows: sql(`select count(*) from invoices where invoice_id='${INV}'`), sheet: sheet() } }, null, 2));
    return { status: 'passed', limitations: ['Preparation only.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
