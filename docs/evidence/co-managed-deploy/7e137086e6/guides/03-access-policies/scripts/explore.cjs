// Exploratory read-only inspection (not a walkthrough): discovers current screens and controls.
const { scenario, credential, sql, fixtures } = require('../../scripts/runtime.cjs');
const root = __dirname + '/../attempts';
(async () => {
  await scenario(root, 'explore-1', async ({ page, actor, go, inspect, shot }) => {
    const fx = fixtures();
    const qa = { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password };
    const alice = { name: 'alice', ...credential('reprovision-20261025-active-admin.json') };
    await actor(qa);
    await go('/msp/clients/' + fx.active.clientId + '?tab=co-managed'); await page.waitForTimeout(4000); await inspect('qa-client-comanaged'); await shot('qa-client-comanaged');
    await go('/msp/tickets/customer?queueView=working&workspace=all'); await page.waitForTimeout(4000); await inspect('qa-customer-tickets'); await shot('qa-customer-tickets');
    await go('/msp/co-management/administration'); await page.waitForTimeout(3000); await inspect('qa-admin'); await shot('qa-admin');
    await actor(alice);
    await go('/msp/co-management'); await page.waitForTimeout(4000); await inspect('alice-policy'); await shot('alice-policy');
    await go('/msp/co-management/ticket-access'); await page.waitForTimeout(3000); await inspect('alice-ticket-access'); await shot('alice-ticket-access');
    await go('/msp/co-management/administration'); await page.waitForTimeout(3000); await inspect('alice-admin'); await shot('alice-admin');
    await go('/msp/settings?tab=ticketing'); await page.waitForTimeout(3000); await inspect('alice-settings-ticketing'); await shot('alice-settings-ticketing');
    await go('/msp/settings/users'); await page.waitForTimeout(3000); await inspect('alice-users'); await shot('alice-users');
    return { status: 'partial', limitations: ['exploration only'] };
  });
})();
