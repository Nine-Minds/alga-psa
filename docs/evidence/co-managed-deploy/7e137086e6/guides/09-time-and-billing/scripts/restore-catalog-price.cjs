// Guide 09 restore (recorded, native UI): remove the USD price row persisted for Basic Support in prep-catalog-usd-price.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, OZ } = require('./common.cjs');
const S = '3105a420-8aab-434e-a872-abd01ad26926';
(async () => {
  const r = await scenario(__dirname + '/..', 'restore-catalog-usd-price', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const prices = () => JSON.parse(sql(`select coalesce(json_agg(p),'[]') from (select currency_code,rate from service_prices where tenant='${OZ}' and service_id='${S}') p`));
    const before = prices(); await mark('before', before);
    await actor(actors.qa()); await chapter('Restore: remove the Basic Support USD price row');
    await go('/msp/billing?tab=service-catalog'); await page.waitForTimeout(2500);
    await page.locator('#service-actions-menu-' + S).click(); await page.locator('#edit-service-' + S).click(); await page.locator('#remove-price-0').waitFor();
    await page.locator('#remove-price-0').click(); await page.waitForTimeout(800); await shot('01-removed-row'); await inspect('01-removed-row');
    await page.locator('#save-button').click(); await page.waitForTimeout(3000); await shot('02-after-save'); await inspect('02-after-save');
    const after = prices(); await mark('after', after);
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after }, null, 2));
    return { status: after.length === 0 ? 'passed' : 'partial', limitations: after.length ? ['Service editor did not remove the stored USD price (see 02-after-save).'] : [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
