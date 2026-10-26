// Read-only UI exploration (selector discovery); not evidence.
const { scenario, credential } = require('../../scripts/runtime.cjs');
const fx = require('/home/robert/card-review-private/co-managed-it-3363/reprovision-20261025-fixtures.json');
const routes = (process.env.ROUTES || '').split(',').filter(Boolean);
const who = process.env.WHO || 'qa';
const creds = { qa: { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password },
  alice: { name: 'alice', ...credential('reprovision-20261025-active-admin.json') },
  kansas: { name: 'kansas', ...credential('reprovision-20261025-departing-admin.json') } };
(async () => {
  await scenario(__dirname + '/../attempts', process.env.NAME || 'explore', async ({ page, actor, go, shot, inspect }) => {
    await actor(creds[who]);
    let i = 0;
    for (const r of routes) { await go(r.replace('SHARED', `/msp/co-management/tickets/${fx.active.customer}/${fx.active.relationship}/${fx.active.ticket}`)); await page.waitForTimeout(Number(process.env.WAIT || 3000)); await shot('r' + i); await inspect('r' + i); i++; }
    return { status: 'exploration' };
  });
})();
