const { scenario } = require('../../scripts/runtime.cjs');
const { actors } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'explore10', async ({ page, actor, go, shot, inspect }) => {
  await actor(actors.qa()); await go('/msp/invoices/3121e2b0-55db-4d8e-95ff-c6dbbe926769'); await page.waitForTimeout(3000); await shot('inv'); await inspect('inv');
  await go('/msp/billing?tab=invoicing&subtab=drafts'); await page.waitForTimeout(3000); await shot('drafts'); await inspect('drafts');
  return { status: 'exploration' };
}); })();
