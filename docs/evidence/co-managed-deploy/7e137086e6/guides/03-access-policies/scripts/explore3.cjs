// Exploratory read-only inspection: Add Board dialog, quick-add ticket dialog, escalation dialog (all cancelled).
const { scenario, credential, fixtures } = require('../../scripts/runtime.cjs');
(async () => {
  await scenario(__dirname + '/../attempts', 'explore-3', async ({ page, actor, go, inspect, shot }) => {
    const alice = { name: 'alice', ...credential('reprovision-20261025-active-admin.json') };
    await actor(alice);
    await go('/msp/settings?tab=ticketing&section=boards'); await page.locator('#add-board-button').click(); await page.waitForTimeout(2500); await inspect('add-board'); await shot('add-board'); await page.keyboard.press('Escape');
    await go('/msp/tickets'); await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor(); await page.waitForTimeout(1500); await inspect('quick-add'); await shot('quick-add');
    await page.locator('#ticket-quick-add-board-picker').click(); await page.waitForTimeout(800); await inspect('quick-add-board'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await go('/msp/tickets/' + fixtures().active.ticket); await page.locator('#co-ticket-escalate').click(); await page.waitForTimeout(1500); await inspect('escalate-dialog'); await shot('escalate-dialog');
    await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
    const show = page.locator('button[id$=-show-comment-editor-btn]'); if (await show.count()) await show.first().click(); await page.waitForTimeout(1500); await inspect('comment-editor'); await shot('comment-editor');
    return { status: 'partial', limitations: ['exploration only'] };
  });
})();
