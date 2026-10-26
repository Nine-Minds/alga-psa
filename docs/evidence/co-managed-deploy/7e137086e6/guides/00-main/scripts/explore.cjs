const { scenario } = require('../../scripts/runtime.cjs');
const { actors, A, fx, sharedRoute } = require('../../09-time-and-billing/scripts/common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go('/msp/tickets/' + fx.native.ticket); await page.waitForTimeout(2000); await shot('native-entry'); await inspect('native-entry');
  await page.locator('#ticket-layout-toggle-grid').click(); await page.waitForTimeout(2000); await shot('native-grid'); await inspect('native-grid');
  await go(sharedRoute(A.ticket)); await page.locator('#ticket-layout-toggle-grid').click(); await page.waitForTimeout(2000); await shot('shared-grid'); await inspect('shared-grid');
  await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
  await page.locator('#co-ticket-assignment-change').click(); await page.waitForTimeout(1500); await shot('shared-assign'); await inspect('shared-assign');
  await actor(actors.kansas());
  await go('/msp/tickets/' + fx.departing.ticket); await page.waitForTimeout(2500); await shot('kansas'); await inspect('kansas');
  return { status: 'exploration' };
}); })();
