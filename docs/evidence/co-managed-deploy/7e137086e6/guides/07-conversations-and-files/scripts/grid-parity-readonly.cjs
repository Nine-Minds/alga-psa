// Guide 07 §1 supplement (read-only): the Grid layout enforces the same audience rules as Entry
// on the final recording's ticket.
const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path');
const fx = require('../fixtures.json'), m = fx.messages, C = L.ids.customer, R = L.ids.relationship;
(async () => { const r = await L.scenario(path.dirname(__dirname), 'supplement-grid-parity-readonly', async ({ page, actor, go, check, shot, chapter }) => {
  for (const [who, route, own, other] of [['qa', `/msp/co-management/tickets/${C}/${R}/${fx.ticketId}`, 'msp-private', 'customer-private'], ['alice', '/msp/tickets/' + fx.ticketId, 'customer-private', 'msp-private']]) {
    await chapter(`1. Grid layout audience parity (${who})`);
    await actor(who === 'qa' ? L.qa() : L.alice()); await go(route);
    await page.getByRole('button', { name: 'Grid', exact: true }).click(); await page.waitForTimeout(1000);
    await page.getByText(m.shared, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    await page.getByText(m[own], { exact: true }).filter({ visible: true }).first().waitFor();
    await page.getByText(m.requester, { exact: true }).filter({ visible: true }).first().waitFor();
    const body = await page.locator('body').innerText();
    await check(`grid-${who}-shows-shared-own-private-and-requester`, true);
    await check(`grid-${who}-hides-other-organization-private`, !body.includes(m[other]));
    await shot(`grid-${who}`);
  }
  return { status: 'passed', limitations: ['Read-only supplement; no data changed.'] }; });
  if (r.scenarioStatus === 'failed') process.exitCode = 1; })();
