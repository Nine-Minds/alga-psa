// Archives CM-REVIEW-20261026-12 Microsoft app registrations left by failed attempts (native provider control).
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, WR } = require('../../09-time-and-billing/scripts/common.cjs');
(async () => { const r = await scenario(__dirname + '/../attempts', process.env.NAME || 'cleanup-archive-attempt-profiles', async ({ page, actor, go, mark, shot, inspect }) => {
  const live = () => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (select profile_id,display_name,is_default from microsoft_profiles where tenant='${WR}' and display_name like 'CM-REVIEW-20261026-12%' and not is_archived) x`));
  await mark('before', live());
  await actor(actors.alice()); await go('/msp/co-management/providers'); await page.locator('#provider-credentials-microsoft-tab').click(); await page.waitForTimeout(2000);
  for (const p of live().filter((x) => !x.is_default)) {
    await page.locator('#microsoft-profile-archive-' + p.profile_id).click(); await page.waitForTimeout(1000); await shot('confirm-' + p.profile_id.slice(0, 8)); await inspect('confirm-' + p.profile_id.slice(0, 8));
    await page.getByRole('button', { name: 'Archive app', exact: true }).click();
    await until(() => !live().some((x) => x.profile_id === p.profile_id), 'archived ' + p.profile_id, 30000);
  }
  await page.reload(); await page.locator('#provider-credentials-microsoft-tab').click(); await page.waitForTimeout(2000); await shot('after');
  await mark('after', live()); return { status: 'cleanup' };
}); if (r.scenarioStatus === 'failed') process.exitCode = 1; })();
