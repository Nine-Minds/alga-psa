const { scenario } = require('../../scripts/runtime.cjs');
const { actors, A } = require('../../09-time-and-billing/scripts/common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore2', async ({ page, ctx, actor, go, shot, inspect }) => {
  await actor(actors.alice());
  await go('/msp/tickets/' + A.ticket); await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1500);
  await page.locator('#ticket-details-conversation-audience-select').click().catch(() => {}); await page.waitForTimeout(800);
  console.log('AUD', await page.getByRole('option').allInnerTexts()); await shot('comment'); await inspect('comment'); await page.keyboard.press('Escape');
  await go('/msp/settings/email'); await page.getByRole('tab', { name: /Inbound/ }).click().catch(() => {}); await page.waitForTimeout(1500); await shot('inbound'); await inspect('inbound');
  console.log('LINKS', await page.locator('a[href*="providers"]').count());
  await go('/msp/security-settings?tab=sso'); await page.waitForTimeout(1500); await shot('sso'); await inspect('sso');
  await ctx.clearCookies(); await go('/auth/msp/signin'); await shot('signin'); await inspect('signin');
  return { status: 'exploration' };
}); })();
