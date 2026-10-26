// Rehearsal: Automatic Invoices selection + preview only (closes the preview, generates nothing).
const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
const CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
(async () => { await scenario(__dirname + '/../attempts', 'rehearse-preview', async ({ page, actor, go, shot, inspect, mark }) => {
  await actor(actors.qa());
  await go('/msp/billing?tab=invoicing'); await page.waitForTimeout(2500);
  const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
  const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };
  const range = page.locator('#billing-period-date-range');
  if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
  await typeDate(range.getByRole('combobox').nth(1), '11/01/2026');
  await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
  const row = table.locator('tbody tr').filter({ hasText: CONTRACT }).filter({ hasText: 'Ready' }).first();
  await row.waitFor(); const box = row.locator('input[id^="select-parent-group"]'); await mark('box', await box.getAttribute('id'));
  await box.check(); await page.locator('#preview-selected-button').click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor(); await page.locator('#generate-invoice-from-preview-button').waitFor(); await page.waitForTimeout(1500);
  await shot('preview'); await inspect('preview'); console.log((await dialog.innerText()).slice(0, 2500));
  await page.keyboard.press('Escape');
  return { status: 'rehearsal-no-generation' };
}); })();
