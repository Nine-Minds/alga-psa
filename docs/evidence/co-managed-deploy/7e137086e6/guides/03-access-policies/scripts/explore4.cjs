// Exploratory: board editor statuses section (not saved).
const { scenario, credential } = require('../../scripts/runtime.cjs');
(async () => {
  await scenario(__dirname + '/../attempts', 'explore-4', async ({ page, actor, go, inspect, shot }) => {
    await actor({ name: 'alice', ...credential('reprovision-20261025-active-admin.json') });
    await go('/msp/settings?tab=ticketing&section=boards'); await page.locator('#add-board-button').click(); await page.locator('#board_name').waitFor();
    await page.locator('#board-editor-section-statuses').click(); await page.waitForTimeout(1500); await inspect('statuses'); await shot('statuses');
    return { status: 'partial' };
  });
})();
