// Cleanup through the real UI: cancel the unclaimed setup left by onboarding attempt 1 (CM-REVIEW-20261026-01 Cancel).
const path = require('path');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, sql, until, OZ, pool, qa } = C;
(async () => {
  const r = await scenario(path.resolve(__dirname, '../attempts'), process.env.CM_CLEAN_NAME || 'onboarding-attempt1-cleanup-cancel', async ({ page, actor, go, check, shot, chapter }) => {
    const clientId = process.env.CM_CLEAN_CLIENT || '9e24700a-3cf0-45d0-bc6c-4dfb15e9b52f', op = process.env.CM_CLEAN_OP || 'b83cc804-287d-465f-bd43-f58d5464b702';
    const state = () => sql(`select state from co_managed_provisioning_operations where tenant='${OZ}' and operation_id='${op}'`);
    const before = pool();
    await actor(qa()); await chapter('Cancel unclaimed setup left by a failed attempt');
    await go(`/msp/clients/${clientId}?tab=co-managed`); await page.locator('[id$="-recovery-cancel"]').first().click();
    await page.getByRole('dialog').filter({ hasText: 'Cancel workspace setup?' }).first().waitFor(); await shot('cancel-dialog');
    await page.locator('[id$="-recovery-cancel-confirm-button"]').first().click();
    await until(() => state() === 'cancelled', 'cancelled', 180000);
    await page.reload(); await page.waitForTimeout(3000); await shot('cancelled');
    await check('attempt1-cancel-fixture-released', pool().allocated === before.allocated - 1, { before, after: pool() });
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
