const { scenario } = require('../../scripts/runtime.cjs');
const { actors, A } = require('../../09-time-and-billing/scripts/common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore3', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.alice());
  await go('/msp/tickets/' + A.ticket); await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1500);
  await page.locator('#ticket-details-conversation-audience-select').click(); await page.waitForTimeout(800);
  console.log('AUD ' + JSON.stringify(await page.getByRole('option').allInnerTexts())); await shot('aud');
  await page.keyboard.press('Escape');
  await go('/msp/security-settings'); await page.getByRole('tab', { name: 'Single Sign-On' }).click(); await page.waitForTimeout(2000); await shot('sso'); await inspect('sso');
  return { status: 'exploration' };
}); })();
