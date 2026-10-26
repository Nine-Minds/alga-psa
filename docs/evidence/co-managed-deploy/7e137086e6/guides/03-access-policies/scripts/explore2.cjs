// Exploratory read-only inspection: opens dialogs without submitting.
const { scenario, credential, sql, fixtures } = require('../../scripts/runtime.cjs');
(async () => {
  await scenario(__dirname + '/../attempts', 'explore-2', async ({ page, actor, go, inspect, shot }) => {
    const alice = { name: 'alice', ...credential('reprovision-20261025-active-admin.json') };
    const qa = { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password };
    await actor(alice);
    await go('/msp/settings?tab=ticketing'); await page.getByRole('tab', { name: 'Boards' }).click(); await page.waitForTimeout(2500); await inspect('alice-boards'); await shot('alice-boards');
    await go('/msp/settings/users'); await page.locator('#create-new-msp-user-btn').click(); await page.waitForTimeout(2500); await inspect('alice-create-user'); await shot('alice-create-user');
    await go('/msp/tickets'); await page.waitForTimeout(3000); await inspect('alice-tickets'); await shot('alice-tickets');
    await go('/msp/tickets/' + fixtures().active.ticket); await page.waitForTimeout(4000); await inspect('alice-ticket'); await shot('alice-ticket');
    await actor(qa);
    await go('/msp/settings/users'); await page.waitForTimeout(2500); await inspect('qa-users'); await page.locator('#create-new-msp-user-btn').click(); await page.waitForTimeout(2500); await inspect('qa-create-user'); await shot('qa-create-user');
    await go('/msp/settings?tab=teams'); await page.waitForTimeout(2500); await inspect('qa-teams');
    return { status: 'partial', limitations: ['exploration only'] };
  });
})();
