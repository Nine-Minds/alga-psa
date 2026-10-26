const { scenario } = require('../../scripts/runtime.cjs');
const { actors, A, sharedRoute } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore6', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go(sharedRoute(A.ticket)); await page.locator('#ticket-details-properties-add-time-entry-btn').click(); await page.waitForTimeout(2500);
  await shot('dlg'); await inspect('dlg'); require('fs').writeFileSync(__dirname+'/../attempts/explore6/dlg.html', await page.locator('body').innerHTML());
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  await actor(actors.alice());
  await go('/msp/tickets/' + A.ticket); await page.waitForTimeout(1500);
  const card = page.locator('#ticket-details-properties-time-summary-card-toggle'); await card.scrollIntoViewIfNeeded(); await shot('alice-card'); await inspect('alice-card');
  return { status: 'exploration' };
}); })();
