const { scenario, credential } = require('../../scripts/runtime.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore-ms', async ({ page, actor, go, shot, inspect }) => {
  await actor({ name: 'alice', ...credential('reprovision-20261025-active-admin.json') });
  await go('/msp/co-management/providers'); await page.locator('#provider-credentials-microsoft-tab').click(); await page.waitForTimeout(1500);
  await shot('ms'); await inspect('ms');
  await page.locator('#microsoft-settings-add-profile').click(); await page.waitForTimeout(1500); await shot('ms-add'); await inspect('ms-add');
  await page.keyboard.press('Escape');
  await go('/auth/msp/signin'); await shot('signin'); await inspect('signin');
  return { status: 'exploration' };
}); })();
