const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore5', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.alice());
  await go('/msp/tickets'); await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor();
  await page.waitForTimeout(1500); await shot('qa'); await inspect('qa');
  await page.locator('#ticket-quick-add-client-trigger').click(); await page.waitForTimeout(800); await shot('qa-client');
  console.log(await page.getByRole('option').allInnerTexts());
  return { status: 'exploration' };
}); })();
