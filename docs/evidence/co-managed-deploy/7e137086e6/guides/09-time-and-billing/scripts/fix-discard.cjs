// Discards the exploratory stopwatch accidentally left running on fixture ticket 000001 (no time saved).
const { scenario, sql } = require('../../scripts/runtime.cjs');
const { actors, A, sharedRoute, OZ } = require('./common.cjs');
(async () => { await scenario(__dirname + '/../attempts', 'fix-discard-exploratory-stopwatch', async ({ page, actor, go, shot, mark }) => {
  await actor(actors.qa());
  await go(sharedRoute(A.ticket)); await page.locator('#ticket-details-properties-timer-stopwatch-discard').click(); await page.waitForTimeout(1500);
  await shot('after-discard-click');
  const confirm = page.getByRole('button', { name: /discard/i }).filter({ visible: true }).last(); if (await confirm.count()) await confirm.click().catch(() => {});
  await page.waitForTimeout(2000); await shot('after-discard');
  await mark('sessions', sql(`select coalesce(json_agg(s),'[]') from (select status,created_at from native_time_tracking_sessions where tenant='${OZ}' and user_id='86952555-610c-4737-be41-a9236cfa9cdb') s`));
  return { status: 'cleanup' };
}); })();
