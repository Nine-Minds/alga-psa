const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore4', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go('/msp/billing?tab=client-contracts'); await page.waitForTimeout(2000); await shot('a'); await inspect('a');
  await page.locator('#client-wizard-button').click(); await page.waitForTimeout(2500); await shot('b'); await inspect('b');
  return { status: 'exploration' };
}); })();
