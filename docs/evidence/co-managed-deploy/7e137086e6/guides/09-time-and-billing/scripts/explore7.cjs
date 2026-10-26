const { scenario } = require('../../scripts/runtime.cjs');
const { actors, A, sharedRoute } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore7', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go(sharedRoute(A.ticket)); await page.locator('#ticket-details-properties-add-time-entry-btn').click();
  await page.locator('#time-entry-dialog-notes-0').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
  await shot('dlg'); await inspect('dlg');
  await page.locator('#time-entry-dialog-cancel-dialog-btn').click(); await page.waitForTimeout(800);
  await page.locator('#ticket-details-properties-timer-stopwatch-start').click(); await page.waitForTimeout(3500); await shot('sw'); await inspect('sw');
  return { status: 'exploration' };
}); })();
