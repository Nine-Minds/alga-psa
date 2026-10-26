// Read-only exploration of the screens used by guides 06/07/08 (navigation + DOM capture only).
const L = require('./lib.cjs'), path = require('path');
const root = path.join(path.dirname(__dirname), 'attempts');
(async () => {
  await L.scenario(root, 'explore-readonly', async ({ page, actor, go, inspect, shot }) => {
    await actor(L.alice());
    for (const [n, r] of [['alice-co-management', '/msp/co-management'], ['alice-projects', '/msp/projects'], ['alice-users', '/msp/settings/users'], ['alice-ticket', '/msp/tickets/' + L.fixtures().active.ticket]]) { await go(r); await page.waitForTimeout(2500); await inspect(n); await shot(n); }
    await actor(L.qa());
    for (const [n, r] of [['qa-client-co', '/msp/clients/' + L.ids.client + '?tab=co-managed'], ['qa-tasks', '/msp/co-management/tasks'], ['qa-sla', '/msp/co-management/sla?operationId=' + L.ids.operation], ['qa-sla-settings', '/msp/settings/sla'], ['qa-teams', '/msp/settings?tab=teams'], ['qa-shared-ticket', '/msp/co-management/tickets/' + L.ids.customer + '/' + L.ids.relationship + '/' + L.fixtures().active.ticket]]) { await go(r); await page.waitForTimeout(2500); await inspect(n); await shot(n); }
    return { status: 'exploration', limitations: ['read-only navigation'] };
  });
})();
