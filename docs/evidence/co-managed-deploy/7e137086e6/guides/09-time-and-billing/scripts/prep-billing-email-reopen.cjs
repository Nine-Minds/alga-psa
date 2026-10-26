// Guide 09 preparation (recorded, native UI): (1) Invoice preview refused because White Rabbit has no billing
// email; set a disposable alternative billing email on the client's Billing configuration (cleared after the run).
// (2) Re-open the QA sheet approved in attempt run-c (Reverse approval, then Request changes) so the clean run's
// new entries can join it and be submitted/approved inside one recording.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, A } = require('./common.cjs');
const SHEET = 'b1adac9e-430c-4c28-abe8-6389bd9a7e70';
const EMAIL = 'cm-review-20261026-09.billing@whiterabbit.test';
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-billing-email-reopen-sheet', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const client = () => JSON.parse(sql(`select row_to_json(c) from (select billing_email,billing_contact_id from clients where client_id='${A.clientId}') c`));
    const sheet = () => sql(`select approval_status from time_sheets where id='${SHEET}'`);
    const before = { client: client(), sheet: sheet() }; await mark('before', before);
    await actor(actors.qa());
    await chapter('Prep: White Rabbit billing configuration gets a disposable alternative billing email');
    await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await shot('01-billing-before');
    if (client().billing_email !== EMAIL) {
      await page.locator('#client-billing-email-input').fill(EMAIL); await page.locator('#save-billing-config-btn').click();
      await until(() => client().billing_email === EMAIL, 'billing email saved');
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await check('billing-email-persists-after-reload', await page.locator('#client-billing-email-input').inputValue() === EMAIL);
    await shot('02-billing-after');
    await chapter('Prep: re-open the sheet approved in attempt run-c');
    await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2000);
    if (sheet() === 'APPROVED') {
      await page.locator('#reverse-approval-' + SHEET + '-btn').click(); await page.locator('#reverse-approval-confirmation-confirm').click();
      await until(() => sheet() !== 'APPROVED', 'approval reversed');
    }
    await mark('after-reverse', { sheet: sheet() }); await shot('03-after-reverse');
    if (sheet() === 'SUBMITTED') {
      await go('/msp/time-sheet-approvals'); await page.locator('#view-timesheet-' + SHEET + '-btn').click();
      await page.locator('#timesheet-request-changes-btn').click(); await until(() => sheet() === 'CHANGES_REQUESTED', 'returned');
    }
    await check('sheet-open-for-changes', ['CHANGES_REQUESTED', 'DRAFT'].includes(sheet()), { sheet: sheet(), entries: JSON.parse(sql(`select json_agg(x) from (select entry_id,approval_status from time_entries where time_sheet_id='${SHEET}') x`)) });
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after: { client: client(), sheet: sheet() } }, null, 2));
    return { status: 'passed', limitations: ['Preparation only; billing email is cleared after the guide 09 recording.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
