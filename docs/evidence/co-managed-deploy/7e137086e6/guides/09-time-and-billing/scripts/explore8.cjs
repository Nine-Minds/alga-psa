const { scenario } = require('../../scripts/runtime.cjs');
const { actors, taskRoute } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore8', async ({ page, actor, go, shot, inspect, mark }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await actor(actors[process.env.WHO || 'alice']());
  await go(taskRoute('4a557b48-9f40-4af9-bfb1-7b9ffe23d21e')); await page.waitForTimeout(4000); await shot('a'); await inspect('a');
  if (await page.locator('#co-shared-log-time').count()) { await page.locator('#co-shared-log-time').click(); await page.waitForTimeout(6000); await shot('b'); await inspect('b'); }
  return { status: 'exploration' };
}); })();
