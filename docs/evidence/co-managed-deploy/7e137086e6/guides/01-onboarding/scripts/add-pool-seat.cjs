// Capacity prep for the onboarding re-run: add one seat through the Co-managed IT pool editor (configured Stripe simulator), as guide 02 documents.
const path = require('path');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, until, pool, purchases, qa } = C;
(async () => {
  const r = await scenario(path.resolve(__dirname, '../attempts'), process.env.CM_PREP_NAME || 'onboarding-capacity-prep-add-seat', async ({ page, actor, go, check, shot, chapter }) => {
    const before = pool(), target = before.capacity + 1;
    await actor(qa()); await chapter('Add one pool seat (simulator) for the onboarding re-run');
    await go('/msp/co-managed'); const qty = page.locator('#co-managed-seat-quantity'); await qty.waitFor();
    await qty.fill(String(target)); await page.locator('#co-managed-review-purchase').click(); await page.locator('#co-managed-confirm-purchase').waitFor(); await shot('review');
    await page.locator('#co-managed-confirm-purchase').click(); await until(() => pool().capacity === target, 'capacity ' + target, 120000);
    await page.reload(); await qty.waitFor(); await shot('after');
    await check('pool-increased-by-one', pool().capacity === target, { before, after: pool(), lastPurchase: purchases().at(-1) });
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
