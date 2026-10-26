const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', process.env.NAME || 'explore2', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors[process.env.WHO || 'qa']());
  await go('/msp/settings/time-entry'); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(2000); await shot('periods'); await inspect('periods');
  const btns = page.getByRole('button', { name: /create|add|generate/i }).filter({ visible: true });
  console.log(await btns.allInnerTexts());
  await btns.first().click(); await page.waitForTimeout(1500); await shot('periods-add'); await inspect('periods-add');
  return { status: 'exploration' };
}); })();
