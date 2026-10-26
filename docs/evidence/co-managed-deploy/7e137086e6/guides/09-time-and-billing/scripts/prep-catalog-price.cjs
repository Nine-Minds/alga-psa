// Guide 09 preparation (recorded, native UI). Invoice preview failed in run-d: "Missing pricing for time entry on
// service Basic Support in USD". The service editor already displays USD $100.00 for Basic Support (from the legacy
// default rate) but no USD price row is stored, and hourly contract-line rates are not used for time charges.
// Saving the service editor unchanged persists the displayed USD price. Then rehearse the preview (no generation)
// and re-open the sheet approved in run-d (Reverse approval -> Request changes) for the clean run.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, OZ } = require('./common.cjs');
const S = '3105a420-8aab-434e-a872-abd01ad26926', SHEET = 'b1adac9e-430c-4c28-abe8-6389bd9a7e70';
const CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-catalog-usd-price', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const prices = () => JSON.parse(sql(`select coalesce(json_agg(p),'[]') from (select currency_code,rate from service_prices where tenant='${OZ}' and service_id='${S}') p`));
    const sheet = () => sql(`select approval_status from time_sheets where id='${SHEET}'`);
    const before = { prices: prices(), sheet: sheet() }; await mark('before', before);
    await actor(actors.qa());
    await chapter('Prep: service editor shows USD $100.00 for Basic Support; saving persists it');
    await go('/msp/billing?tab=service-catalog'); await page.waitForTimeout(2500);
    await page.locator('#service-actions-menu-' + S).click(); await page.locator('#edit-service-' + S).click();
    await page.locator('#edit-price-rate-0').waitFor();
    await check('editor-displays-usd-price-although-none-stored', (await page.locator('#edit-price-currency-0').innerText()).includes('USD') && await page.locator('#edit-price-rate-0').inputValue() === '100.00' && before.prices.length === 0, { stored: before.prices });
    await shot('01-editor');
    await page.locator('#save-button').click(); await page.waitForTimeout(2000);
    const rollout = page.getByRole('dialog').filter({ hasText: /roll|apply|existing contracts/i }); if (await rollout.count()) { await shot('01b-rollout'); await inspect('01b-rollout'); }
    await until(() => prices().length > 0, 'USD price stored', 30000);
    await check('usd-price-persisted', prices().some((p) => p.currency_code === 'USD' && Number(p.rate) === 10000), { prices: prices() });
    await shot('02-saved');
    await chapter('Rehearsal: Automatic Invoices preview now prices the approved contract time (closed, nothing generated)');
    await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
    const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };
    const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
    const range = page.locator('#billing-period-date-range'); if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
    await typeDate(range.getByRole('combobox').nth(1), '11/01/2026'); await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
    const row = table.locator('tbody tr').filter({ hasText: CONTRACT }).filter({ hasText: 'Ready' }).first();
    await row.locator('input[id^="select-parent-group"]').check(); await page.locator('#preview-selected-button').click();
    const dialog = page.getByRole('dialog'); await page.locator('#generate-invoice-from-preview-button').waitFor(); await page.waitForTimeout(2000);
    const preview = await dialog.innerText(); await shot('03-preview'); await mark('preview', preview.slice(0, 1500));
    await check('preview-renders-without-error', !/Something went wrong/.test(preview));
    await page.getByRole('button', { name: /Close Preview/ }).click();
    await chapter('Prep: re-open the sheet approved in run-d');
    await go('/msp/time-sheet-approvals'); await page.locator('#toggle-approved-btn').click(); await page.waitForTimeout(2000);
    if (sheet() === 'APPROVED') { await page.locator('#reverse-approval-' + SHEET + '-btn').click(); await page.locator('#reverse-approval-confirmation-confirm').click(); await until(() => sheet() !== 'APPROVED', 'reversed'); }
    if (sheet() === 'SUBMITTED') { await go('/msp/time-sheet-approvals'); await page.locator('#view-timesheet-' + SHEET + '-btn').click(); await page.locator('#timesheet-request-changes-btn').click(); await until(() => sheet() === 'CHANGES_REQUESTED', 'returned'); }
    await check('sheet-open-for-changes', ['CHANGES_REQUESTED', 'DRAFT'].includes(sheet()), { sheet: sheet() });
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after: { prices: prices(), sheet: sheet() } }, null, 2));
    return { status: 'passed', limitations: ['Preparation only. The stored USD price is the value the editor already displayed; removal is attempted after the guide run.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
