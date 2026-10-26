const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
const S = '3105a420-8aab-434e-a872-abd01ad26926';
(async () => { await scenario(__dirname + '/../attempts', 'explore9', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go('/msp/billing?tab=client-contracts'); await page.getByRole('link', { name: 'Services', exact: true }).first().click(); await page.waitForTimeout(3000);
  console.log(page.url());
  await page.locator('#service-actions-menu-' + S).click(); await page.locator('#edit-service-' + S).click(); await page.waitForTimeout(1500);
  await page.locator('#add-currency-btn').click(); await page.waitForTimeout(800);
  await shot('edit'); await inspect('edit');
  return { status: 'exploration-no-save' };
}); })();
