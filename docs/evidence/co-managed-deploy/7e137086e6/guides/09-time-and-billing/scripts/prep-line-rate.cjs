// Guide 09 preparation (recorded, native UI). Defect workaround: the contract wizard showed a prefilled
// $100.00 hourly rate ("using the catalog default rate") but persisted no rate, so invoice preview failed
// ("Missing pricing ... Basic Support in USD", shown to the user only as a generic error with a reference).
// Set the rate explicitly on the disposable contract line through the contract's line editor.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, OZ } = require('./common.cjs');
const LINE = '9e12f69d-62cb-4b76-b8a7-b27bf6f3f8db', CONFIG = '1df5ccc3-718d-4d09-987e-e6f6f4ec824c';
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-contract-line-rate', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const rate = () => JSON.parse(sql(`select row_to_json(x) from (select (select custom_rate from contract_line_service_configuration where config_id='${CONFIG}') as config_rate,(select custom_rate from contract_line_services where contract_line_id='${LINE}') as service_rate) x`));
    const before = rate(); await mark('before', before);
    const contractId = sql(`select contract_id from contract_lines where contract_line_id='${LINE}'`);
    await actor(actors.qa());
    await chapter('Prep: set the hourly rate explicitly on the disposable contract line');
    await go(`/msp/billing?tab=client-contracts&contractId=${contractId}&contractView=lines`); await page.waitForTimeout(3000);
    await shot('01-lines'); await inspect('01-lines');
    await page.locator('#edit-' + LINE).click(); await page.locator('#rate-' + CONFIG).waitFor({ timeout: 30000 });
    await shot('02-edit');
    await page.locator('#rate-' + CONFIG).fill('100.00'); await page.locator('#rate-' + CONFIG).blur();
    await page.locator('#save-line-' + LINE).click();
    await until(() => Number(rate().config_rate) === 10000 || Number(rate().service_rate) === 10000, 'rate persisted', 30000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(2500);
    await check('contract-line-rate-persisted', true, { after: rate() });
    await shot('03-after-reload');
    fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ before, after: rate() }, null, 2));
    return { status: 'passed', limitations: ['Preparation only; works around the contract wizard rate defect on the disposable contract.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
