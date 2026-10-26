const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore3', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa());
  await go('/msp/settings/time-entry'); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(1500);
  await page.locator('#create-time-period-button').click(); await page.waitForTimeout(1500); await shot('dlg'); await inspect('dlg');
  const html = await page.getByRole('dialog').innerHTML(); require('fs').writeFileSync(__dirname + '/../attempts/explore3/dlg.html', html);
  return { status: 'exploration' };
}); })();
